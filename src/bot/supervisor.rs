//! Spawns + drives a `BotManager`.
//!
//! Lives outside `lib::run` so the same entry point can be reused both at
//! startup (when `bot.enabled` is true on first config load) and at
//! runtime (when the user flips `bot.enabled` via the first-run wizard or
//! settings page — `update_config` calls this instead of forcing the user
//! to restart Akagi).

use crate::bot::registry::BotRegistry;
use crate::bot::runtime::PythonRuntime;
use crate::bot::BotManager;
use crate::config::AppConfig;
use crate::event_bus::{BotResponseBus, BotStatusBus, NotifyBus, PostTrackerBus};
use crate::inspector::InspectorWriter;
use crate::util;
use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, RwLock};
use tracing::{info, warn};

/// Background cold-start warmer for a Python subprocess bot (`mjai_bot/*`).
///
/// Spawns `bot.py 0` in the background, feeds a synthetic `start_game` +
/// `end_game` probe, and waits for the reply so the OS page cache and
/// Windows Defender scan Python, PyTorch DLLs, `libriichi`, and `mortal.pth`
/// while the user is still in the lobby rather than on the first game's
/// turn clock.
pub fn spawn_bot_prewarm(runtime: PythonRuntime, entry_dir: PathBuf) {
    if !crate::bot::runtime::is_synced(&entry_dir) {
        return;
    }
    tokio::spawn(async move {
        let bot_name = entry_dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("bot")
            .to_owned();
        let started = std::time::Instant::now();
        let mut cmd = runtime.command_for(&entry_dir, &["bot.py", "0"]);
        cmd.env("AKAGI_PLAYER_ID", "0")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let Ok(mut child) = cmd.spawn() else {
            return;
        };
        let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            return;
        };
        let probe = b"[{\"type\":\"start_game\",\"names\":[\"0\",\"1\",\"2\",\"3\"],\"id\":0,\"num_players\":4},{\"type\":\"end_game\"}]\n";
        if stdin.write_all(probe).await.is_err() || stdin.flush().await.is_err() {
            return;
        }
        let mut reader = tokio::io::BufReader::new(stdout);
        let mut line = String::new();
        match tokio::time::timeout(
            std::time::Duration::from_secs(60),
            reader.read_line(&mut line),
        )
        .await
        {
            Ok(Ok(n)) if n > 0 => {
                let _ =
                    tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await;
                info!(
                    bot = %bot_name,
                    elapsed_ms = started.elapsed().as_millis() as u64,
                    "subprocess bot pre-warmed in background"
                );
            }
            _ => {
                let _ = child.start_kill();
            }
        }
    });
}

/// Build a `BotManager` from the shared `config` + `runtime` and run it
/// until the post-tracker bus closes. Returns `Err` only on setup failure (missing
/// runtime, unscannable bot dir); transient runtime errors are absorbed by
/// the manager itself.
///
/// The manager holds the shared `Arc<RwLock<AppConfig>>` and re-reads the
/// active-bot selection at each `start_game`, so a model switch made while
/// the manager is running takes effect on the next game without a relaunch.
#[allow(clippy::too_many_arguments)]
pub async fn run_bot_manager(
    config: Arc<RwLock<AppConfig>>,
    events: PostTrackerBus,
    response_bus: BotResponseBus,
    status_bus: BotStatusBus,
    notify_bus: NotifyBus,
    inspector: InspectorWriter,
    runtime: Option<PythonRuntime>,
    syncs_in_flight: Arc<Mutex<HashSet<String>>>,
) -> Result<()> {
    let bot_dir = {
        let cfg = config.read().await;
        let bot_dir = util::resolve_dir(Path::new(&cfg.bot.dir));
        // Diagnostic-only: warn early if the configured bots aren't present
        // *now*. The manager rescans on every spawn so a bot installed after
        // this point is still picked up — the warning here is just to surface
        // mis-config quickly in logs, not to gate startup.
        let registry = BotRegistry::scan(&bot_dir)?;
        let mut warmed = HashSet::new();
        for (label, name) in [("4p", &cfg.bot.active_4p), ("3p", &cfg.bot.active_3p)] {
            // Built-in native bots aren't in the `mjai_bot/` registry — don't
            // warn about them being "missing".
            if !name.is_empty() && !crate::bot::native::is_native(name) {
                match registry.find(name) {
                    Some(entry) => {
                        if let Some(rt) = runtime.as_ref() {
                            if warmed.insert(name.clone()) {
                                spawn_bot_prewarm(rt.clone(), entry.dir.clone());
                            }
                        }
                    }
                    None => {
                        warn!(
                            "configured {} bot {:?} not found under {}; available: {:?}",
                            label,
                            name,
                            bot_dir.display(),
                            registry.names().collect::<Vec<_>>()
                        );
                    }
                }
            }
        }
        bot_dir
    };

    // A Python runtime is optional: the built-in native bot needs none. Only
    // Python `mjai_bot/*` subprocess bots require it, and that's enforced
    // per-spawn inside the manager (a missing runtime fails just that spawn,
    // not the whole manager) so the native bot always runs.
    if runtime.is_none() {
        warn!(
            "no python3+uv runtime found; the built-in bot will still work, but Python mjai_bot subprocess bots cannot be spawned"
        );
    }

    let manager = BotManager::new(
        runtime,
        bot_dir,
        config,
        response_bus,
        status_bus,
        notify_bus,
        inspector,
        syncs_in_flight,
    );
    let rx = events.subscribe();
    manager.run(rx).await
}
