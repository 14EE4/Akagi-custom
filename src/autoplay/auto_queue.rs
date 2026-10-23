//! Auto-queue subsystem: automatically searches for the next match after a game ends.
//!
//! Configurable sequence on game end:
//! 1. EndGame event received on `MjaiBus`.
//! 2. Check if auto-queue is enabled and increment match count.
//! 3. If `max_matches > 0 && current_matches >= max_matches`, stop auto queue.
//! 4. Step through settlement screens: click `confirm_x, confirm_y` for `confirm_clicks` times
//!    with `confirm_delay_ms` delay between each click.
//! 5. Final match result screen reached -> Wait randomized human-like delay with live countdown.
//! 6. Click rematch ("한번더") button at `(rematch_x, rematch_y)`.
//! 7. Wait `modal_delay_ms` for confirmation modal dialog to pop up.
//! 8. Click modal confirmation ("네") button at `(modal_yes_x, modal_yes_y)`.
//! 9. Client enters match queue!

use std::sync::Arc;
use std::time::Duration;
use rand::Rng;
use tokio::sync::{broadcast::error::RecvError, RwLock};
use tracing::{info, warn};

use crate::autoplay::cdp_input::{dispatch_click, evaluate_canvas_rect, show_click_marker};
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
                MjaiEvent::EndGame { .. } => {
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

                    // 3. Step through settlement screens: 확인(우하단)
                    {
                        let mut st = status.write().await;
                        st.state = "queuing".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }

                    let confirm_clicks = aq.confirm_clicks.clamp(1, 10);
                    let confirm_delay = Duration::from_millis(aq.confirm_delay_ms.max(500) as u64);

                    let mut aborted = false;
                    for step_idx in 1..=confirm_clicks {
                        tokio::time::sleep(confirm_delay).await;
                        if !cfg.read().await.autoplay.auto_queue.enabled {
                            aborted = true;
                            break;
                        }

                        let label = format!("확인 ({step_idx}/{confirm_clicks})");
                        info!(
                            "auto_queue: clicking confirm ({step_idx}/{confirm_clicks}) at ({:.2}, {:.2})",
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
                    }

                    if aborted {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // 최종 결과 화면 도달 대기
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // 4. Random delay countdown before clicking rematch
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

                    // 5. Click "한번더" (우하단 우측에서 2번째, 확인 좌측)
                    {
                        let mut st = status.write().await;
                        st.state = "queuing".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }

                    info!(
                        "auto_queue: clicking rematch '한번더' button at ({:.2}, {:.2})",
                        aq.rematch_x, aq.rematch_y
                    );
                    if let Err(e) = execute_click_with_indicator(
                        &ctx,
                        aq.rematch_x,
                        aq.rematch_y,
                        "한번더 (재전)",
                        aq.show_click_indicator,
                    )
                    .await
                    {
                        warn!("auto_queue: rematch click failed: {e}");
                    }

                    // 6. 창 뜨는 딜레이 대기
                    let modal_delay = Duration::from_millis(aq.modal_delay_ms.max(500) as u64);
                    tokio::time::sleep(modal_delay).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // 7. 창 뜨면 가운데 (종으로 하단 가운데) 좌측 '네' 버튼 클릭
                    info!(
                        "auto_queue: clicking dialog confirm '네' button at ({:.2}, {:.2})",
                        aq.modal_yes_x, aq.modal_yes_y
                    );
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
                    } else if let Err(e) = res {
                        warn!("auto_queue: modal yes click failed: {e}");
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
