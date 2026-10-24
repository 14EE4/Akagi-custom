//! Auto-queue subsystem: automatically searches for the next match after a game ends.
//!
//! Two strategies supported:
//! 1. "lobby" (Default, robust):
//!    - EndGame event received on `MjaiBus`.
//!    - Step through settlement screens by clicking bottom-right confirm `(confirm_x, confirm_y)`
//!      until Chromium CDP detects that the game has transitioned to `MajsoulScreenState::Lobby`.
//!    - Wait randomized human-like delay with live countdown.
//!    - Sequential navigation in lobby: [단위전] -> [4인 마작] -> [은탁] -> [반장전].
//!    - Client enters match queue!
//!
//! 2. "rematch" (Legacy):
//!    - Step through settlement screens for fixed `confirm_clicks` times.
//!    - Click rematch ("한번더") button at `(rematch_x, rematch_y)`.
//!    - Wait `modal_delay_ms` for confirmation modal dialog to pop up.
//!    - Click modal confirmation ("네") button at `(modal_yes_x, modal_yes_y)`.

use std::sync::Arc;
use std::time::Duration;
use rand::Rng;
use tokio::sync::{broadcast::error::RecvError, RwLock};
use tracing::{info, warn};

use crate::autoplay::cdp_input::{
    dispatch_click, evaluate_canvas_rect, show_click_marker,
};
use crate::autoplay::context::AutoplayContext;
use crate::config::AppConfig;
use crate::event_bus::{AutoQueueStatusBus, MjaiBus, NotifyBus};
use crate::schema::{AutoQueueStatus, MjaiEvent, Notification, NotifyLevel};

async fn reset_status(
    status: &Arc<RwLock<AutoQueueStatus>>,
    status_bus: &AutoQueueStatusBus,
) {
    let mut st = status.write().await;
    st.state = "idle".into();
    st.wait_seconds_left = None;
    let _ = status_bus.send(st.clone());
}

/// Executes a click at 16:9 normalized coordinate `(x_norm, y_norm)` on the game canvas.
/// Returns `Ok((pixel_x, pixel_y, canvas_width, canvas_height))` on success or `Err(reason)` on failure.
pub async fn execute_click_with_indicator(
    ctx: &Arc<AutoplayContext>,
    x_norm: f64,
    y_norm: f64,
    label: &str,
    show_marker: bool,
) -> Result<(f64, f64, f64, f64), String> {
    let page_guard = ctx.page.read().await;
    let page = page_guard
        .as_ref()
        .ok_or_else(|| "브라우저 페이지 핸들을 찾을 수 없습니다 (Chromium 미실행)".to_string())?;

    let rect = match evaluate_canvas_rect(page).await {
        Ok(r) => {
            *ctx.canvas_rect.write().await = Some(r);
            r
        }
        Err(e) => {
            if let Some(r) = *ctx.canvas_rect.read().await {
                r
            } else {
                return Err(format!("캔버스 크기 측정 실패: {e:#}"));
            }
        }
    };

    let (px, py) = rect.pixel(x_norm, y_norm);
    if !rect.contains(px, py) {
        return Err(format!(
            "계산된 좌표 ({px:.1}, {py:.1})가 캔버스 영역 [{rect:?}] 밖입니다."
        ));
    }

    if show_marker {
        let _ = show_click_marker(page, px, py, label).await;
    }

    if let Err(e) = dispatch_click(page, px, py, 150, 80).await {
        return Err(format!("CDP 클릭 전송 실패: {e:#}"));
    }

    Ok((px, py, rect.width, rect.height))
}

/// Dedicated auto-queue watcher loop on its own `MjaiBus` subscription.
pub async fn auto_queue_watcher(
    cfg: Arc<RwLock<AppConfig>>,
    ctx: Arc<AutoplayContext>,
    bus: MjaiBus,
    notify: NotifyBus,
    status: Arc<RwLock<AutoQueueStatus>>,
    status_bus: AutoQueueStatusBus,
) {
    let mut rx = bus.subscribe();
    info!("auto-queue watcher started");

    loop {
        match rx.recv().await {
            Ok(ev) => match ev {
                MjaiEvent::StartGame { .. } | MjaiEvent::StartKyoku { .. } => {
                    crate::bridge::majsoul::record_game_start();
                    let mut st = status.write().await;
                    if st.state != "in_game" {
                        st.state = "in_game".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }
                }
                MjaiEvent::EndGame { .. } => {
                    crate::bridge::majsoul::record_game_end();

                    let aq = {
                        let guard = cfg.read().await;
                        guard.autoplay.auto_queue.clone()
                    };

                    if !aq.enabled {
                        continue;
                    }

                    // 1. Increment completed matches count
                    let current_matches = {
                        let mut st = status.write().await;
                        st.current_matches += 1;
                        st.max_matches = aq.max_matches;
                        let cm = st.current_matches;
                        let _ = status_bus.send(st.clone());
                        cm
                    };

                    // 2. Check if reached max matches
                    if aq.max_matches > 0 && current_matches >= aq.max_matches {
                        info!(
                            "auto_queue: reached max matches ({current_matches}/{}) - stopping auto queue",
                            aq.max_matches
                        );
                        {
                            let mut guard = cfg.write().await;
                            guard.autoplay.auto_queue.enabled = false;
                        }
                        {
                            let mut st = status.write().await;
                            st.enabled = false;
                            st.state = "idle".into();
                            st.wait_seconds_left = None;
                            let _ = status_bus.send(st.clone());
                        }
                        let _ = notify.send(Notification {
                            level: NotifyLevel::Info,
                            title: "자동 대국 완료".into(),
                            body: Some(format!(
                                "목표한 최대 대국 수({}판)를 완료하여 자동 다음 대국 찾기를 종료합니다.",
                                aq.max_matches
                            )),
                            sticky: false,
                            id: Some("auto-queue-done".into()),
                        });
                        continue;
                    }

                    let progress_str = if aq.max_matches > 0 {
                        format!("{current_matches}/{}판", aq.max_matches)
                    } else {
                        format!("{current_matches}판 완료")
                    };

                    {
                        let mut st = status.write().await;
                        st.state = "queuing".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }

                    // 대국 종료 직후 정산 연출 초기 대기
                    let initial_delay = Duration::from_millis(aq.initial_delay_ms.max(500) as u64);
                    tokio::time::sleep(initial_delay).await;

                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // -------------------------------------------------------------
                    // Strategy 1: "lobby" (Exit to lobby, then click rank match)
                    // -------------------------------------------------------------
                    if aq.strategy != "rematch" {
                        let confirm_delay =
                            Duration::from_millis(aq.lobby_confirm_delay_ms.max(500) as u64);

                        let mut aborted = false;

                        // 1. 이미 유저가 직접 확인을 눌러 로비로 복귀했는지 확인
                        if !crate::bridge::majsoul::is_settling() {
                            info!("auto_queue: 이미 메인 로비에 도달해 있으므로 정산 확인 클릭을 생략합니다.");
                        } else {
                            // 2. 정산 화면을 넘기기 위한 확인 클릭 루프 (최대 required_confirms회)
                            let required_confirms = aq.confirm_clicks.max(6).clamp(6, 15);

                            for click_idx in 1..=required_confirms {
                                if !cfg.read().await.autoplay.auto_queue.enabled {
                                    aborted = true;
                                    break;
                                }

                                // 이미 로비에 복귀했다면 즉시 확인 클릭 중단
                                if !crate::bridge::majsoul::is_settling() {
                                    info!(
                                        "auto_queue: 로비 복귀 감지됨 (is_settling=false) -> 확인 클릭({}회 완료 후) 즉시 종료",
                                        click_idx.saturating_sub(1)
                                    );
                                    break;
                                }

                                let label = format!("확인/로비탈출 ({click_idx}/{required_confirms})");
                                info!(
                                    "auto_queue: clicking confirm ({click_idx}/{required_confirms}) at ({:.2}, {:.2})",
                                    aq.confirm_x, aq.confirm_y
                                );
                                if let Err(e) = execute_click_with_indicator(
                                    &ctx,
                                    aq.confirm_x,
                                    aq.confirm_y,
                                    &label,
                                    aq.show_click_indicator,
                                )
                                .await
                                {
                                    warn!("auto_queue: confirm click failed: {e}");
                                }

                                tokio::time::sleep(confirm_delay).await;

                                // 클릭 후 로비 복귀 확인
                                if !crate::bridge::majsoul::is_settling() {
                                    info!(
                                        "auto_queue: 로비 복귀 감지됨 (is_settling=false) -> 확인 클릭({click_idx}회 완료 후) 즉시 종료"
                                    );
                                    break;
                                }
                            }

                            if aborted {
                                reset_status(&status, &status_bus).await;
                                continue;
                            }
                        }

                        // 정산 완료 공식 확정 -> 메인 로비 상태
                        crate::bridge::majsoul::record_settlement_finished();
                        info!("auto_queue: 메인 로비 진입 확정 -> 단위전 매칭 시퀀스 준비");

                        // 로비 최종 도달 안정화 대기
                        tokio::time::sleep(Duration::from_millis(1500)).await;

                        // 휴식 딜레이 카운트다운
                        let min_sec = aq.min_delay_sec.max(2);
                        let max_sec = aq.max_delay_sec.max(min_sec);
                        let delay_sec = rand::rng().random_range(min_sec..=max_sec);

                        let _ = notify.send(Notification {
                            level: NotifyLevel::Info,
                            title: "자동 다음 대국 대기".into(),
                            body: Some(format!(
                                "{delay_sec}초 후 로비에서 단위전 매칭을 시작합니다. ({progress_str})"
                            )),
                            sticky: false,
                            id: Some("auto-queue-waiting".into()),
                        });

                        let mut cancelled = false;
                        for sec_left in (1..=delay_sec).rev() {
                            {
                                let mut st = status.write().await;
                                st.state = "waiting".into();
                                st.wait_seconds_left = Some(sec_left);
                                let _ = status_bus.send(st.clone());
                            }

                            tokio::select! {
                                _ = tokio::time::sleep(Duration::from_secs(1)) => {
                                    let cur_enabled = cfg.read().await.autoplay.auto_queue.enabled;
                                    if !cur_enabled {
                                        info!("auto_queue: disabled by user during countdown");
                                        cancelled = true;
                                        break;
                                    }
                                }
                                msg = rx.recv() => match msg {
                                    Ok(MjaiEvent::StartGame { .. }) => {
                                        info!("auto_queue: new game already started during countdown");
                                        cancelled = true;
                                        break;
                                    }
                                    Ok(_) | Err(RecvError::Lagged(_)) => {}
                                    Err(RecvError::Closed) => return,
                                }
                            }
                        }

                        if cancelled {
                            reset_status(&status, &status_bus).await;
                            continue;
                        }

                        // 로비 단위전 순차 클릭 네비게이션
                        {
                            let mut st = status.write().await;
                            st.state = "queuing".into();
                            st.wait_seconds_left = None;
                            let _ = status_bus.send(st.clone());
                        }

                        let step_delay =
                            Duration::from_millis(aq.lobby_step_delay_ms.max(500) as u64);

                        // 1. [단위전] 클릭 (11.5, 2.8)
                        info!(
                            "auto_queue: clicking [단위전] button at ({:.2}, {:.2})",
                            aq.rank_match_x, aq.rank_match_y
                        );
                        let _ = execute_click_with_indicator(
                            &ctx,
                            aq.rank_match_x,
                            aq.rank_match_y,
                            "1. 단위전",
                            aq.show_click_indicator,
                        )
                        .await;
                        tokio::time::sleep(step_delay).await;

                        // 2. [은탁] 카드 클릭 (11.5, 4.6)
                        info!(
                            "auto_queue: clicking [은탁] card at ({:.2}, {:.2})",
                            aq.room_card_x, aq.room_card_y
                        );
                        let _ = execute_click_with_indicator(
                            &ctx,
                            aq.room_card_x,
                            aq.room_card_y,
                            "2. 은탁",
                            aq.show_click_indicator,
                        )
                        .await;
                        tokio::time::sleep(step_delay).await;

                        // 3. [4인 반장전] 버튼 클릭 (은탁과 위치 동일: 11.5, 4.6)
                        info!(
                            "auto_queue: clicking [4인 반장전] button at ({:.2}, {:.2})",
                            aq.round_type_x, aq.round_type_y
                        );
                        let res = execute_click_with_indicator(
                            &ctx,
                            aq.round_type_x,
                            aq.round_type_y,
                            "3. 4인 반장전",
                            aq.show_click_indicator,
                        )
                        .await;

                        if res.is_ok() {
                            let _ = notify.send(Notification {
                                level: NotifyLevel::Info,
                                title: "다음 대국 매칭 시작".into(),
                                body: Some(format!("은탁 반장전 대국을 검색 중입니다. ({progress_str})")),
                                sticky: false,
                                id: Some("auto-queue-matched".into()),
                            });
                        }

                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // -------------------------------------------------------------
                    // Strategy 2: "rematch" (Legacy: Click rematch on settlement screen)
                    // -------------------------------------------------------------
                    let confirm_clicks = aq.confirm_clicks.clamp(1, 10);
                    let confirm_delay = Duration::from_millis(aq.confirm_delay_ms.max(500) as u64);

                    let mut aborted = false;
                    for step_idx in 1..=confirm_clicks {
                        if !cfg.read().await.autoplay.auto_queue.enabled {
                            aborted = true;
                            break;
                        }

                        let label = format!("확인 ({step_idx}/{confirm_clicks})");
                        info!(
                            "auto_queue: clicking confirm ({step_idx}/{confirm_clicks}) at ({:.2}, {:.2})",
                            aq.confirm_x, aq.confirm_y
                        );
                        let _ = execute_click_with_indicator(
                            &ctx,
                            aq.confirm_x,
                            aq.confirm_y,
                            &label,
                            aq.show_click_indicator,
                        )
                        .await;

                        tokio::time::sleep(confirm_delay).await;
                    }

                    if aborted {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    let rematch_prep_delay =
                        Duration::from_millis(aq.rematch_delay_ms.max(500) as u64);
                    tokio::time::sleep(rematch_prep_delay).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    let min_sec = aq.min_delay_sec.max(2);
                    let max_sec = aq.max_delay_sec.max(min_sec);
                    let delay_sec = rand::rng().random_range(min_sec..=max_sec);

                    let _ = notify.send(Notification {
                        level: NotifyLevel::Info,
                        title: "자동 다음 대국 대기".into(),
                        body: Some(format!("{delay_sec}초 후 다음 대국을 찾습니다. ({progress_str})")),
                        sticky: false,
                        id: Some("auto-queue-waiting".into()),
                    });

                    let mut cancelled = false;
                    for sec_left in (1..=delay_sec).rev() {
                        {
                            let mut st = status.write().await;
                            st.state = "waiting".into();
                            st.wait_seconds_left = Some(sec_left);
                            let _ = status_bus.send(st.clone());
                        }

                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                                if !cfg.read().await.autoplay.auto_queue.enabled {
                                    cancelled = true;
                                    break;
                                }
                            }
                            msg = rx.recv() => match msg {
                                Ok(MjaiEvent::StartGame { .. }) => {
                                    cancelled = true;
                                    break;
                                }
                                Ok(_) | Err(RecvError::Lagged(_)) => {}
                                Err(RecvError::Closed) => return,
                            }
                        }
                    }

                    if cancelled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // Click "한번더"
                    {
                        let mut st = status.write().await;
                        st.state = "queuing".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }

                    let _ = execute_click_with_indicator(
                        &ctx,
                        aq.rematch_x,
                        aq.rematch_y,
                        "한번더 (재전)",
                        aq.show_click_indicator,
                    )
                    .await;

                    let modal_delay = Duration::from_millis(aq.modal_delay_ms.max(500) as u64);
                    tokio::time::sleep(modal_delay).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // Click "네"
                    let res = execute_click_with_indicator(
                        &ctx,
                        aq.modal_yes_x,
                        aq.modal_yes_y,
                        "네 (확인)",
                        aq.show_click_indicator,
                    )
                    .await;

                    if res.is_ok() {
                        let _ = notify.send(Notification {
                            level: NotifyLevel::Info,
                            title: "다음 대국 매칭 시작".into(),
                            body: Some(format!("새 대국을 검색 중입니다. ({progress_str})")),
                            sticky: false,
                            id: Some("auto-queue-matched".into()),
                        });
                    }

                    reset_status(&status, &status_bus).await;
                }
                _ => {}
            },
            Err(RecvError::Lagged(_)) => continue,
            Err(RecvError::Closed) => return,
        }
    }
}
