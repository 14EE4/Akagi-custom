//! Auto-queue subsystem: automatically searches for the next match after a game ends.
//!
//! Subscribes to `MjaiBus`. Upon receiving `MjaiEvent::EndGame`:
//! 1. Checks if auto-queue is enabled.
//! 2. Increments the match counter.
//! 3. If `max_matches > 0 && current_matches >= max_matches`, marks auto-queue complete
//!    and turns the toggle off.
//! 4. Waits a human-like randomized delay (`min_delay_sec..=max_delay_sec`).
//!    Supports immediate cancellation if the user toggles auto-queue off or a new game begins.
//! 5. Fast-forwards through the settlement and result screens by clicking the canvas center,
//!    then clicks the "再戦" (Rematch / Next Game) button at `(11.2, 8.2)` on the 16:9 canvas.

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

                    // 3. Calculate random delay (e.g. 8~15s)
                    let min_sec = min_delay_sec.max(3);
                    let max_sec = max_delay_sec.max(min_sec);
                    let delay_sec = rand::rng().random_range(min_sec..=max_sec);

                    let progress_str = if max_matches > 0 {
                        format!("{current_matches}/{max_matches}판")
                    } else {
                        format!("{current_matches}판 완료")
                    };

                    let _ = notify.send(Notification {
                        level: NotifyLevel::Info,
                        title: "자동 다음 대국 대기".into(),
                        body: Some(format!("{delay_sec}초 후 다음 대국을 찾습니다. ({progress_str})")),
                        sticky: false,
                        id: Some("auto-queue-waiting".into()),
                    });

                    // 4. Countdown loop with responsive cancellation
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
                        let mut st = status.write().await;
                        st.state = "idle".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                        continue;
                    }

                    // 5. Perform clicks
                    {
                        let mut st = status.write().await;
                        st.state = "queuing".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }

                    // Fast-forward settlement screen: click center (8.0, 4.5)
                    click_canvas_point(&ctx, 8.0, 4.5, 150, 80).await;
                    tokio::time::sleep(Duration::from_millis(1500)).await;

                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        let mut st = status.write().await;
                        st.state = "idle".into();
                        let _ = status_bus.send(st.clone());
                        continue;
                    }

                    // Fast-forward second screen (rank points / event / level up): click center (8.0, 4.5)
                    click_canvas_point(&ctx, 8.0, 4.5, 150, 80).await;
                    tokio::time::sleep(Duration::from_millis(1200)).await;

                    if !cfg.read().await.autoplay.auto_queue.enabled {
                        let mut st = status.write().await;
                        st.state = "idle".into();
                        let _ = status_bus.send(st.clone());
                        continue;
                    }

                    // Click Rematch ("再戦") button at (11.2, 8.2)
                    let clicked = click_canvas_point(&ctx, 11.2, 8.2, 200, 100).await;
                    if clicked {
                        let _ = notify.send(Notification {
                            level: NotifyLevel::Info,
                            title: "다음 대국 매칭 시작".into(),
                            body: Some(format!("새 대국을 검색 중입니다. ({progress_str})")),
                            sticky: false,
                            id: Some("auto-queue-matched".into()),
                        });
                    }

                    {
                        let mut st = status.write().await;
                        st.state = "idle".into();
                        st.wait_seconds_left = None;
                        let _ = status_bus.send(st.clone());
                    }
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
