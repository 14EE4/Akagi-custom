//! Native downloader and unpacker for bundled Python + uv runtime.
//!
//! Downloads official `python-build-standalone` and astral-sh `uv` archives
//! into `<exe_dir>/runtime/{python,uv}/<triple>/` so fresh clones or portable
//! installations work automatically without manual scripting.

use crate::bot::runtime::PythonRuntime;
use crate::event_bus::NotifyBus;
use crate::schema::Notification;
use anyhow::{bail, Context, Result};
use flate2::read::GzDecoder;
use std::path::{Component, Path, PathBuf};
use tar::Archive;
use tracing::info;

const PYTHON_VERSION: &str = "3.12.13";
const PBS_RELEASE: &str = "20260414";
const UV_VERSION: &str = "0.11.8";

/// Determine host triple for python-build-standalone & uv.
pub fn host_triple() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "x86_64") {
            "x86_64-pc-windows-msvc"
        } else {
            "i686-pc-windows-msvc"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-unknown-linux-gnu"
        } else {
            "x86_64-unknown-linux-gnu"
        }
    } else {
        "unknown"
    }
}

/// Destination root for the runtime next to the current executable.
pub fn runtime_root() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("get current exe path")?;
    let exe_dir = exe.parent().context("get exe dir")?;
    Ok(exe_dir.join("runtime"))
}

/// Download a file to disk with simple progress notifications.
async fn download_file(client: &reqwest::Client, url: &str, dest: &Path) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    let res = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    if !res.status().is_success() {
        bail!("download failed: HTTP {} from {url}", res.status());
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .with_context(|| format!("create {}", dest.display()))?;
    let mut stream = res.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("read chunk")?;
        file.write_all(&chunk).await.context("write chunk")?;
    }
    file.flush().await.context("flush file")?;
    Ok(())
}

/// Safely extract a .tar.gz archive, stripping the single top-level directory if present.
fn extract_tar_gz_strip_components(archive_path: &Path, dest_dir: &Path, strip: usize) -> Result<()> {
    let file = std::fs::File::open(archive_path)
        .with_context(|| format!("open {}", archive_path.display()))?;
    let gz = GzDecoder::new(file);
    let mut a = Archive::new(gz);

    for entry in a.entries().context("read tar entries")? {
        let mut entry = entry.context("read tar entry")?;
        let path = entry.path().context("entry path")?.into_owned();
        let comps: Vec<_> = path.components().collect();
        if comps.len() <= strip {
            continue;
        }
        let stripped_components = &comps[strip..];
        let mut rel = PathBuf::new();
        for c in stripped_components {
            match c {
                Component::Normal(n) => rel.push(n),
                _ => {}
            }
        }
        if rel.as_os_str().is_empty() {
            continue;
        }
        let out_path = dest_dir.join(&rel);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            entry.unpack(&out_path)?;
        }
    }
    Ok(())
}

/// Download and setup Python + uv runtime if missing.
pub async fn ensure_runtime_installed(notify: Option<&NotifyBus>) -> Result<PythonRuntime> {
    let triple = host_triple();
    let root = runtime_root()?;
    let py_dir = root.join("python").join(triple);
    let uv_dir = root.join("uv").join(triple);

    let py_bin = py_dir.join(if cfg!(windows) { "python.exe" } else { "bin/python3" });
    let uv_bin = uv_dir.join(if cfg!(windows) { "uv.exe" } else { "uv" });

    if py_bin.is_file() && uv_bin.is_file() {
        return Ok(PythonRuntime::from_paths(py_bin, uv_bin, crate::bot::RuntimeMode::Bundled));
    }

    let toast = "runtime-auto-download";
    if let Some(n) = notify {
        let _ = n.send(
            Notification::info("Python 런타임 준비 중…")
                .body("필요한 Python 및 uv 런타임을 자동으로 다운로드하여 설정합니다.")
                .sticky()
                .id(toast),
        );
    }

    let client = reqwest::Client::builder()
        .user_agent("akagi-runtime-downloader")
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .context("build http client")?;

    let downloads = root.join(".downloads");
    std::fs::create_dir_all(&downloads)?;

    // 1. Download & Extract Python if missing
    if !py_bin.is_file() {
        info!("downloading python-build-standalone for {triple}");
        let pbs_file = format!("cpython-{PYTHON_VERSION}+{PBS_RELEASE}-{triple}-install_only.tar.gz");
        let pbs_url = format!("https://github.com/astral-sh/python-build-standalone/releases/download/{PBS_RELEASE}/{pbs_file}");
        let py_archive = downloads.join(&pbs_file);

        if !py_archive.is_file() {
            download_file(&client, &pbs_url, &py_archive).await.context("download python archive")?;
        }

        std::fs::create_dir_all(&py_dir)?;
        extract_tar_gz_strip_components(&py_archive, &py_dir, 1).context("extract python archive")?;
        let _ = std::fs::remove_file(&py_archive);
    }

    // 2. Download & Extract uv if missing
    if !uv_bin.is_file() {
        info!("downloading uv for {triple}");
        let uv_ext = if cfg!(windows) { "zip" } else { "tar.gz" };
        let uv_file = format!("uv-{triple}.{uv_ext}");
        let uv_url = format!("https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{uv_file}");
        let uv_archive = downloads.join(&uv_file);

        if !uv_archive.is_file() {
            download_file(&client, &uv_url, &uv_archive).await.context("download uv archive")?;
        }

        std::fs::create_dir_all(&uv_dir)?;
        if cfg!(windows) {
            crate::github::extract_zip_safe(&uv_archive, &downloads.join("uv_extracted"))?;
            let mut extracted_uv = downloads.join("uv_extracted").join(format!("uv-{triple}")).join("uv.exe");
            if !extracted_uv.is_file() {
                extracted_uv = downloads.join("uv_extracted").join("uv.exe");
            }
            if extracted_uv.is_file() {
                std::fs::copy(&extracted_uv, &uv_bin)?;
            }
            let _ = std::fs::remove_dir_all(downloads.join("uv_extracted"));
        } else {
            extract_tar_gz_strip_components(&uv_archive, &uv_dir, 1)?;
        }
        let _ = std::fs::remove_file(&uv_archive);
    }

    let _ = std::fs::remove_dir_all(&downloads);

    if let Some(n) = notify {
        let _ = n.send(
            Notification::success("Python 런타임 준비 완료")
                .body("Python 및 uv 환경 설정이 성공적으로 완료되었습니다.")
                .id(toast),
        );
    }

    if py_bin.is_file() && uv_bin.is_file() {
        Ok(PythonRuntime::from_paths(py_bin, uv_bin, crate::bot::RuntimeMode::Bundled))
    } else {
        bail!("Runtime setup finished but binaries are still missing");
    }
}
