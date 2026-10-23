//! Auto-queue subsystem: automatically searches for the next match after a game ends.
//!
//! Sequence on game end:
//! 1. EndGame event received on `MjaiBus`.
//! 2. Check if auto-queue is enabled and increment match count.
//! 3. If `max_matches > 0 && current_matches >= max_matches`, stop auto queue.
//! 4. 3x Bottom-right "확인" clicks with animation delay:
//!    - Screen 1 (score calculation) -> 확인 at `(13.9, 8.2)`
//!    - Screen 2 (rank/uma animation) -> 확인 at `(13.9, 8.2)`
//!    - Screen 3 (points/coins/bond) -> 확인 at `(13.9, 8.2)`
//! 5. Final match result screen reached -> Wait randomized human-like delay with live countdown.
//! 6. Click "한번더" (Rematch) button: 우하단 우측에서 2번째 (확인 좌측) at `(11.2, 8.2)`.
//! 7. Confirmation modal pops up -> Click "네" (Yes) button: 가운데 (종으로 하단 가운데) 좌측 at `(6.9, 5.9)`.
//! 8. Client enters match queue!

use std::sync::Arc;
use std::time::Duration;
use rand::Rng;
use tokio::sync::{broadcast::error::RecvError, RwLock};
use tracing::{info, warn};

use crate::autoplay::cdp_input::{dispatch_click, evaluate_canvas_rect};
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
                    let (enabled, max_matches, min_delay_sec, max_delay_sec) = {
                        let guard = cfg.read().await;
                        let aq = &guard.autoplay.auto_queue;
                        (aq.enabled, aq.max_matches, aq.min_delay_sec, aq.max_delay_sec)
                    };

                    if !enabled {
                        continue;
                    }

                    // 1. Increment completed matches count
                    let current_matches = {
                        let mut st = status.write().await;
                        st.current_matches += 1;
                        st.max_matches = max_matches;
                        let cm = st.current_matches;
                        let _ = status_bus.send(st.clone());
                        cm
                    };

                    // 2. Check if reached max matches
                    if max_matches > 0 && current_matches >= max_matches {
                        info!("auto_queue: reached max matches ({current_matches}/{max_matches}) - stopping auto queue");
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
                                "목표한 최대 대국 수({max_matches}판)를 완료하여 자동 다음 대국 찾기를 종료합니다."
                            )),
                            sticky: false,
                            id: Some("auto-queue-done".into()),
                        });
                        continue;
                    }

                    let progress_str = if max_matches > 0 {
                        format!("{current_matches}/{max_matches}판")
                    } else {
                        format!("{current_matches}판 완료")
                    };

                    // 3. Step through settlement screens: 확인(우하단) * 3번
                    {
                        let mut st = status.write().await;
                        st.state = "queuing".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }

                    // 확인 1회차 (점수 정산 연출 후 우하단 확인)
                    tokio::time::sleep(Duration::from_millis(2600)).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }
                    info!("auto_queue: clicking bottom-right confirm (1/3) at (13.9, 8.2)");
                    click_canvas_point(&ctx, 13.9, 8.2, 150, 80).await;

                    // 확인 2회차 (순위/우마 연출 후 우하단 확인)
                    tokio::time::sleep(Duration::from_millis(2400)).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }
                    info!("auto_queue: clicking bottom-right confirm (2/3) at (13.9, 8.2)");
                    click_canvas_point(&ctx, 13.9, 8.2, 150, 80).await;

                    // 확인 3회차 (단위/동전/인연 포인트 연출 후 우하단 확인)
                    tokio::time::sleep(Duration::from_millis(2400)).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }
                    info!("auto_queue: clicking bottom-right confirm (3/3) at (13.9, 8.2)");
                    click_canvas_point(&ctx, 13.9, 8.2, 150, 80).await;

                    // 최종 결과 화면 도달 대기
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // 4. Random delay countdown before clicking rematch
                    let min_sec = min_delay_sec.max(2);
                    let max_sec = max_delay_sec.max(min_sec);
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

                    // 5. Click "한번더" (우하단 우측에서 2번째, 확인 좌측: 11.2, 8.2)
                    {
                        let mut st = status.write().await;
                        st.state = "queuing".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }

                    info!("auto_queue: clicking rematch '한번더' button at (11.2, 8.2)");
                    click_canvas_point(&ctx, 11.2, 8.2, 200, 100).await;

                    // 6. 창 뜨는 딜레이 대기 (1.5초)
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        reset_status(&status, &status_bus).await;
                        continue;
                    }

                    // 7. 창 뜨면 가운데 (종으로 하단 가운데) 좌측 '네' 버튼 클릭 (6.9, 5.9)
                    info!("auto_queue: clicking dialog confirm '네' button at (6.9, 5.9)");
                    let clicked = click_canvas_point(&ctx, 6.9, 5.9, 200, 100).await;

                    if clicked {
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

async fn click_canvas_point(
    ctx: &Arc<AutoplayContext>,
    x_norm: f64,
    y_norm: f64,
    hover_delay_ms: u32,
    click_hold_ms: u32,
) -> bool {
    let page_guard = ctx.page.read().await;
    let Some(page) = page_guard.as_ref() else {
        warn!("auto_queue: no page handle to click");
        return false;
    };

    let rect = match evaluate_canvas_rect(page).await {
        Ok(r) => {
            *ctx.canvas_rect.write().await = Some(r);
            r
        }
        Err(e) => {
            warn!("auto_queue: evaluate_canvas_rect failed: {e:#}");
            if let Some(r) = *ctx.canvas_rect.read().await {
                r
            } else {
                return false;
            }
        }
    };

    let (px, py) = rect.pixel(x_norm, y_norm);
    if !rect.contains(px, py) {
        warn!("auto_queue: point ({px}, {py}) outside canvas rect {rect:?}");
        return false;
    }

    if let Err(e) = dispatch_click(page, px, py, hover_delay_ms, click_hold_ms).await {
        warn!("auto_queue: dispatch_click failed: {e:#}");
        return false;
    }

    true
}
