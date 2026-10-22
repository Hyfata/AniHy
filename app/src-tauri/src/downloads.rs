//! Rust 네이티브 다운로더 + 오프라인 저장소 + 오프라인 시청기록 (계획 §3.3, §3.4).
//!
//! - 저장: {app_data_dir}/downloads/{aid}/{safe_ep}.mp4 (+ .chapters.vtt, cover.{ext})
//! - 메타: SQLite (rusqlite 자체 커넥션) — downloads / local_history 테이블
//! - 재생: 커스텀 프로토콜 anihy://localhost/{video,chapters,cover}/... (Range 지원)
//! - 인증: webview 쿠키 저장소(cookies_for_url, HttpOnly 포함) + JS가 넘기는
//!   document.cookie(비HttpOnly 폴팩 — Android는 cookies_for_url 미지원) 병합.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};

use futures_util::StreamExt;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const SERVER_URL: &str = env!("ANIHY_SERVER_URL");
const PROGRESS_EVENT: &str = "download-progress";
/// 단일 프로토콜 응답의 최대 청크 — open-ended Range(`bytes=0-`)도 이 크기로 잘라
/// 206으로 응답한다 (브라우저가 나머지를 이어서 요청). 전체 파일을 메모리에 올리지 않기 위함.
const PROTOCOL_CHUNK_CAP: u64 = 8 * 1024 * 1024;

/// 서버 services/urls.py sanitize_filename과 동일 규칙.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn url_encode(segment: &str) -> String {
    // 서버의 quote(safe="")와 동일하게 unreserved만 남기고 인코딩
    let mut out = String::new();
    for b in segment.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// ---------- 상태 ----------

pub struct Db(Mutex<Connection>);

impl Db {
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().expect("downloads db poisoned")
    }
}

pub struct DownloadsDir(pub PathBuf);

type TaskMap = Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>;

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    dir: PathBuf,
    http: reqwest::Client,
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?.join("downloads");
    std::fs::create_dir_all(&dir)?;

    let conn = Connection::open(dir.join("meta.db"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS downloads(
           anime_id INTEGER NOT NULL,
           episode_number TEXT NOT NULL,
           title TEXT NOT NULL DEFAULT '',
           anime_title TEXT NOT NULL DEFAULT '',
           cover_local TEXT,
           size_bytes INTEGER NOT NULL DEFAULT 0,
           chapters INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL,
           PRIMARY KEY(anime_id, episode_number)
         );
         CREATE TABLE IF NOT EXISTS local_history(
           anime_id INTEGER NOT NULL,
           episode_number TEXT NOT NULL,
           position_ms INTEGER NOT NULL DEFAULT 0,
           duration_ms INTEGER NOT NULL DEFAULT 0,
           updated_at INTEGER NOT NULL,
           synced INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY(anime_id, episode_number)
         );",
    )?;

    app.manage(Db(Mutex::new(conn)));
    app.manage(DownloadsDir(dir));
    app.manage(TaskMap::default());
    Ok(())
}

// ---------- 공통 페이로드 ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    aid: i64,
    ep: String,
    pct: f64,
    bytes_per_sec: f64,
    /// started | progress | completed | failed | cancelled
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeSpec {
    pub episode_number: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedEpisodeOut {
    anime_id: i64,
    episode_number: String,
    title: String,
    size_bytes: i64,
    downloaded_at: i64,
    chapters: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedAnimeOut {
    anime_id: i64,
    title: String,
    cover: Option<String>,
    total_size: i64,
    episodes: Vec<DownloadedEpisodeOut>,
}

// ---------- 쿠키 ----------

fn server_base() -> String {
    SERVER_URL.trim_end_matches('/').to_string()
}

/// webview 쿠키 저장소 + JS가 넘긴 document.cookie 병합 → Cookie 헤더 값.
/// Android는 cookies_for_url 미지원(빈 Vec)이라 JS 폴팩이 필수 — README 참고.
async fn build_cookie_header(webview: &WebviewWindow, js_cookie: Option<&str>) -> String {
    let mut pairs: Vec<String> = Vec::new();
    if let Ok(url) = server_base().parse::<url::Url>() {
        let wv = webview.clone();
        if let Ok(cookies) = tauri::async_runtime::spawn_blocking(move || {
            wv.cookies_for_url(url).unwrap_or_default()
        })
        .await
        {
            pairs.extend(cookies.into_iter().map(|c| format!("{}={}", c.name(), c.value())));
        }
    }
    if let Some(js) = js_cookie {
        for part in js.split(';') {
            let part = part.trim();
            if !part.is_empty() && !pairs.iter().any(|p| p.starts_with(&format!("{}=", part.split('=').next().unwrap_or("")))) {
                pairs.push(part.to_string());
            }
        }
    }
    pairs.join("; ")
}

// ---------- 다운로드 코어 ----------

fn emit(app: &AppHandle, p: ProgressPayload) {
    let _ = app.emit(PROGRESS_EVENT, p);
}

fn task_key(aid: i64, ep: &str) -> String {
    format!("{aid}/{ep}")
}

async fn fetch_to_file(
    http: &reqwest::Client,
    app: &AppHandle,
    url: &str,
    cookie: &str,
    dest: &PathBuf,
    aid: i64,
    ep: &str,
    report: bool,
) -> Result<u64, String> {
    let res = http
        .get(url)
        .header(reqwest::header::COOKIE, cookie)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0);
    let part = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    use tokio::io::AsyncWriteExt;
    let mut stream = res.bytes_stream();
    let mut received: u64 = 0;
    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut last_bytes: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;

        if report && last_emit.elapsed().as_millis() >= 200 {
            let secs = last_emit.elapsed().as_secs_f64();
            let bps = (received - last_bytes) as f64 / secs.max(0.001);
            let pct = if total > 0 {
                received as f64 / total as f64
            } else {
                0.0
            };
            emit(
                app,
                ProgressPayload {
                    aid,
                    ep: ep.to_string(),
                    pct,
                    bytes_per_sec: bps,
                    status: "progress".into(),
                    message: None,
                },
            );
            last_emit = Instant::now();
            last_bytes = received;
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&part, dest).await.map_err(|e| e.to_string())?;
    let _ = started;
    Ok(total.max(received))
}

/// 회차 1건 다운로드(영상 + 챕터 + 커버 best-effort) 후 DB 반영.
async fn download_one(
    ctx: &Ctx,
    db: &Db,
    cookie: &str,
    aid: i64,
    ep: &str,
    title: &str,
    anime_title: &str,
    chapters_url: Option<&str>,
    cover_url: Option<&str>,
) -> Result<(), String> {
    let safe = sanitize_filename(ep);
    let anime_dir = ctx.dir.join(aid.to_string());
    tokio::fs::create_dir_all(&anime_dir)
        .await
        .map_err(|e| e.to_string())?;

    emit(
        &ctx.app,
        ProgressPayload {
            aid,
            ep: ep.to_string(),
            pct: 0.0,
            bytes_per_sec: 0.0,
            status: "started".into(),
            message: None,
        },
    );

    // 영상 (실패 시 전체 실패)
    let video_url = format!("{}/api/files/video/{}/{}", server_base(), aid, url_encode(ep));
    let size = fetch_to_file(
        &ctx.http,
        &ctx.app,
        &video_url,
        cookie,
        &anime_dir.join(format!("{safe}.mp4")),
        aid,
        ep,
        true,
    )
    .await?;

    // 챕터 (best-effort)
    let mut has_chapters = false;
    if chapters_url.is_some() {
        let url = format!(
            "{}/api/files/animes/{}/{}.chapters.vtt",
            server_base(),
            aid,
            url_encode(&safe)
        );
        if fetch_to_file(
            &ctx.http,
            &ctx.app,
            &url,
            cookie,
            &anime_dir.join(format!("{safe}.chapters.vtt")),
            aid,
            ep,
            false,
        )
        .await
        .is_ok()
        {
            has_chapters = true;
        }
    }

    // 커버 (애니당 1회, best-effort)
    if let Some(cover) = cover_url {
        let ext = cover.rsplit('.').next().unwrap_or("jpg");
        let ext = if ext.len() <= 5 { ext } else { "jpg" };
        let dest = anime_dir.join(format!("cover.{ext}"));
        if !dest.exists() {
            let url = if cover.starts_with("http") {
                cover.to_string()
            } else {
                format!("{}{}", server_base(), cover)
            };
            let _ = fetch_to_file(&ctx.http, &ctx.app, &url, cookie, &dest, aid, ep, false).await;
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let cover_local = anime_dir
        .read_dir()
        .ok()
        .and_then(|mut it| {
            it.find_map(|e| {
                let n = e.ok()?.file_name().to_string_lossy().to_string();
                n.starts_with("cover.").then_some(n)
            })
        });
    db.conn().execute(
        "INSERT INTO downloads(anime_id, episode_number, title, anime_title, cover_local, size_bytes, chapters, created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(anime_id, episode_number) DO UPDATE SET
           title=excluded.title, anime_title=excluded.anime_title,
           cover_local=COALESCE(excluded.cover_local, downloads.cover_local),
           size_bytes=excluded.size_bytes, chapters=excluded.chapters, created_at=excluded.created_at",
        params![aid, ep, title, anime_title, cover_local, size as i64, has_chapters as i64, now],
    ).map_err(|e| e.to_string())?;

    emit(
        &ctx.app,
        ProgressPayload {
            aid,
            ep: ep.to_string(),
            pct: 1.0,
            bytes_per_sec: 0.0,
            status: "completed".into(),
            message: None,
        },
    );
    Ok(())
}

// ---------- 커맨드 ----------

#[tauri::command]
pub async fn download_episode(
    app: AppHandle,
    webview: WebviewWindow,
    db: State<'_, Db>,
    dir: State<'_, DownloadsDir>,
    aid: i64,
    ep: String,
    title: String,
    anime_title: String,
    chapters_url: Option<String>,
    cover_url: Option<String>,
    cookie_header: Option<String>,
) -> Result<(), String> {
    let key = task_key(aid, &ep);
    let ctx = Ctx {
        app: app.clone(),
        dir: dir.0.clone(),
        http: reqwest::Client::new(),
    };
    let cookie = build_cookie_header(&webview, cookie_header.as_deref()).await;
    let tasks = app.state::<TaskMap>().inner().clone();
    {
        let map = tasks.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&key) {
            return Err("이미 다운로드 중입니다".into());
        }
    }
    let dbh = Db(Mutex::new(Connection::open(dir.0.join("meta.db")).map_err(|e| e.to_string())?));
    let _ = db; // 앱 레벨 커넥션은 유지, 작업은 별도 커넥션(태스크 이동용)
    let tasks2 = tasks.clone();
    let key2 = key.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let result = download_one(
            &ctx,
            &dbh,
            &cookie,
            aid,
            &ep,
            &title,
            &anime_title,
            chapters_url.as_deref(),
            cover_url.as_deref(),
        )
        .await;
        if let Err(msg) = result {
            let status = if msg == "cancelled" { "cancelled" } else { "failed" };
            emit(
                &app,
                ProgressPayload {
                    aid,
                    ep,
                    pct: 0.0,
                    bytes_per_sec: 0.0,
                    status: status.into(),
                    message: (status == "failed").then_some(msg),
                },
            );
        }
        if let Ok(mut map) = tasks2.lock() {
            map.remove(&key2);
        }
    });
    tasks
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key, handle);
    Ok(())
}

#[tauri::command]
pub async fn download_all(
    app: AppHandle,
    webview: WebviewWindow,
    dir: State<'_, DownloadsDir>,
    aid: i64,
    anime_title: String,
    episodes: Vec<EpisodeSpec>,
    cover_url: Option<String>,
    cookie_header: Option<String>,
) -> Result<(), String> {
    let key = format!("all:{aid}");
    let tasks = app.state::<TaskMap>().inner().clone();
    {
        let map = tasks.lock().map_err(|e| e.to_string())?;
        if map.contains_key(&key) {
            return Err("이미 전체 다운로드 중입니다".into());
        }
    }
    let cookie = build_cookie_header(&webview, cookie_header.as_deref()).await;
    let ctx = Ctx {
        app: app.clone(),
        dir: dir.0.clone(),
        http: reqwest::Client::new(),
    };
    let db_path = dir.0.join("meta.db");
    let tasks2 = tasks.clone();
    let key2 = key.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let db = Db(Mutex::new(Connection::open(db_path).expect("meta.db open")));
        for ep in episodes {
            // 취소 여부는 태스크 abort로 처리 (JoinHandle abort)
            if let Err(msg) = download_one(
                &ctx,
                &db,
                &cookie,
                aid,
                &ep.episode_number,
                &ep.title,
                &anime_title,
                Some(""),
                cover_url.as_deref(),
            )
            .await
            {
                emit(
                    &ctx.app,
                    ProgressPayload {
                        aid,
                        ep: ep.episode_number.clone(),
                        pct: 0.0,
                        bytes_per_sec: 0.0,
                        status: "failed".into(),
                        message: Some(msg),
                    },
                );
                // 한 회차 실패핟 나머지 계속 (구 native-bridge와 동일)
            }
        }
        if let Ok(mut map) = tasks2.lock() {
            map.remove(&key2);
        }
    });
    tasks
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key, handle);
    Ok(())
}

#[tauri::command]
pub fn cancel_download(app: AppHandle, aid: Option<i64>, ep: Option<String>) -> Result<(), String> {
    let tasks = app.state::<TaskMap>().inner().clone();
    let mut map = tasks.lock().map_err(|e| e.to_string())?;
    let keys: Vec<String> = match (aid, ep) {
        (Some(a), Some(e)) => vec![task_key(a, &e)],
        (Some(a), None) => map
            .keys()
            .filter(|k| k.starts_with(&format!("{a}/")) || k.as_str() == format!("all:{a}").as_str())
            .cloned()
            .collect(),
        (None, None) => map.keys().cloned().collect(),
        (None, Some(_)) => return Err("ep만 지정할 수는 없습니다".into()),
    };
    for k in keys {
        if let Some(h) = map.remove(&k) {
            h.abort();
            // UI 정리용 이벤트 — "aid/ep" 또는 "all:{aid}" (후자는 ep="*")
            if let Some(rest) = k.strip_prefix("all:") {
                emit(&app, ProgressPayload {
                    aid: rest.parse().unwrap_or(0), ep: "*".into(), pct: 0.0,
                    bytes_per_sec: 0.0, status: "cancelled".into(), message: None,
                });
            } else if let Some((a, e)) = k.split_once('/') {
                emit(&app, ProgressPayload {
                    aid: a.parse().unwrap_or(0), ep: e.to_string(), pct: 0.0,
                    bytes_per_sec: 0.0, status: "cancelled".into(), message: None,
                });
            }
        }
    }
    Ok(())
}

fn remove_anime_files(dir: &std::path::Path, aid: i64) {
    let _ = std::fs::remove_dir_all(dir.join(aid.to_string()));
}

#[tauri::command]
pub fn delete_episode(db: State<'_, Db>, dir: State<'_, DownloadsDir>, aid: i64, ep: String) -> Result<(), String> {
    let safe = sanitize_filename(&ep);
    let base = dir.0.join(aid.to_string());
    let _ = std::fs::remove_file(base.join(format!("{safe}.mp4")));
    let _ = std::fs::remove_file(base.join(format!("{safe}.chapters.vtt")));
    let conn = db.conn();
    conn.execute(
        "DELETE FROM downloads WHERE anime_id=?1 AND episode_number=?2",
        params![aid, ep],
    )
    .map_err(|e| e.to_string())?;
    // 마지막 회차면 커버/디렉터리 정리 (구 native-bridge 규약)
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM downloads WHERE anime_id=?1",
            params![aid],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if remaining == 0 {
        remove_anime_files(&dir.0, aid);
    }
    Ok(())
}

#[tauri::command]
pub fn delete_anime(db: State<'_, Db>, dir: State<'_, DownloadsDir>, aid: i64) -> Result<(), String> {
    db.conn()
        .execute("DELETE FROM downloads WHERE anime_id=?1", params![aid])
        .map_err(|e| e.to_string())?;
    remove_anime_files(&dir.0, aid);
    Ok(())
}

#[tauri::command]
pub fn delete_all_downloads(db: State<'_, Db>, dir: State<'_, DownloadsDir>) -> Result<(), String> {
    db.conn()
        .execute("DELETE FROM downloads", [])
        .map_err(|e| e.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&dir.0) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                let _ = std::fs::remove_dir_all(p);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_downloads(db: State<'_, Db>) -> Result<Vec<DownloadedAnimeOut>, String> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT anime_id, episode_number, title, anime_title, cover_local, size_bytes, chapters, created_at
             FROM downloads ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut order: Vec<i64> = Vec::new();
    let mut map: HashMap<i64, DownloadedAnimeOut> = HashMap::new();
    for row in rows.flatten() {
        let (aid, ep, title, anime_title, cover, size, chapters, created) = row;
        let entry = map.entry(aid).or_insert_with(|| {
            order.push(aid);
            DownloadedAnimeOut {
                anime_id: aid,
                title: anime_title.clone(),
                cover: None,
                total_size: 0,
                episodes: Vec::new(),
            }
        });
        if entry.cover.is_none() {
            entry.cover = cover.map(|c| format!("anihy://localhost/cover/{aid}?f={c}"));
        }
        entry.total_size += size;
        entry.episodes.push(DownloadedEpisodeOut {
            anime_id: aid,
            episode_number: ep,
            title,
            size_bytes: size,
            downloaded_at: created,
            chapters: chapters != 0,
        });
    }
    Ok(order.into_iter().filter_map(|aid| map.remove(&aid)).collect())
}

// ---------- 오프라인 시청기록 ----------

#[tauri::command]
pub fn record_local_history(
    db: State<'_, Db>,
    aid: i64,
    ep: String,
    position_ms: i64,
    duration_ms: i64,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    db.conn().execute(
        "INSERT INTO local_history(anime_id, episode_number, position_ms, duration_ms, updated_at, synced)
         VALUES(?1,?2,?3,?4,?5,0)
         ON CONFLICT(anime_id, episode_number) DO UPDATE SET
           position_ms=excluded.position_ms, duration_ms=excluded.duration_ms,
           updated_at=excluded.updated_at, synced=0",
        params![aid, ep, position_ms, duration_ms, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHistoryEntry {
    position_ms: i64,
    duration_ms: i64,
    updated_at: i64,
}

#[tauri::command]
pub fn get_local_history(
    db: State<'_, Db>,
    aid: i64,
    ep: String,
) -> Result<Option<LocalHistoryEntry>, String> {
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT position_ms, duration_ms, updated_at FROM local_history WHERE anime_id=?1 AND episode_number=?2")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![aid, ep]).map_err(|e| e.to_string())?;
    if let Some(r) = rows.next().map_err(|e| e.to_string())? {
        return Ok(Some(LocalHistoryEntry {
            position_ms: r.get(0).map_err(|e| e.to_string())?,
            duration_ms: r.get(1).map_err(|e| e.to_string())?,
            updated_at: r.get(2).map_err(|e| e.to_string())?,
        }));
    }
    Ok(None)
}

#[tauri::command]
pub fn pending_history_count(db: State<'_, Db>) -> Result<i64, String> {
    db.conn()
        .query_row("SELECT COUNT(*) FROM local_history WHERE synced=0", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_history(
    webview: WebviewWindow,
    db: State<'_, Db>,
    cookie_header: Option<String>,
) -> Result<i64, String> {
    let rows: Vec<(i64, String, i64, i64, i64)> = {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT anime_id, episode_number, position_ms, duration_ms, updated_at FROM local_history WHERE synced=0")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    if rows.is_empty() {
        return Ok(0);
    }

    #[derive(Serialize)]
    struct Item {
        anime_id: i64,
        episode_number: String,
        position_ms: i64,
        duration_ms: i64,
        updated_at: i64,
    }
    let items: Vec<Item> = rows
        .iter()
        .map(|(aid, ep, pos, dur, at)| Item {
            anime_id: *aid,
            episode_number: ep.clone(),
            position_ms: *pos,
            duration_ms: *dur,
            updated_at: *at,
        })
        .collect();

    let cookie = build_cookie_header(&webview, cookie_header.as_deref()).await;
    let res = reqwest::Client::new()
        .post(format!("{}/api/history/bulk", server_base()))
        .header(reqwest::header::COOKIE, cookie)
        .json(&items)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("동기화 실패 (HTTP {})", res.status()));
    }
    // 서버가 updated_at 최신 우선으로 충돌 처리 — 전송분은 전부 동기화 완료로 표시
    let conn = db.conn();
    for (aid, ep, _, _, _) in &rows {
        conn.execute(
            "UPDATE local_history SET synced=1 WHERE anime_id=?1 AND episode_number=?2",
            params![aid, ep],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(rows.len() as i64)
}

// ---------- anihy:// 커스텀 프로토콜 ----------

/// anihy://localhost/video/{aid}/{ep} | chapters/{aid}/{ep} | cover/{aid}?f=cover.jpg
/// Range 지원 — 응답은 최대 PROTOCOL_CHUNK_CAP 바이트로 잘라 206.
pub fn handle_protocol<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, StatusCode};

    let not_found = || {
        tauri::http::Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap()
    };

    let dir = match ctx.app_handle().try_state::<DownloadsDir>() {
        Some(d) => d.0.clone(),
        None => return not_found(),
    };

    let path = request.uri().path().trim_start_matches('/');
    let segs: Vec<&str> = path.split('/').collect();
    if segs.len() < 3 {
        return not_found();
    }
    let (kind, aid, ep) = (segs[0], segs[1], segs[2]);
    let safe = sanitize_filename(ep);

    let (file, mime) = match kind {
        "video" => (dir.join(aid).join(format!("{safe}.mp4")), "video/mp4"),
        "chapters" => (
            dir.join(aid).join(format!("{safe}.chapters.vtt")),
            "text/vtt",
        ),
        "cover" => {
            // 쿼리 f=파일명 (DB의 cover_local). 없으면 디렉터리에서 탐색.
            let fname = request
                .uri()
                .query()
                .and_then(|q| {
                    q.split('&')
                        .find_map(|kv| kv.strip_prefix("f=").map(|v| v.to_string()))
                })
                .map(|f| sanitize_filename(&f));
            let found = fname.or_else(|| {
                std::fs::read_dir(dir.join(aid)).ok()?.find_map(|e| {
                    let n = e.ok()?.file_name().to_string_lossy().to_string();
                    n.starts_with("cover.").then_some(n)
                })
            });
            match found {
                Some(f) => {
                    let mime = if f.ends_with(".png") {
                        "image/png"
                    } else if f.ends_with(".webp") {
                        "image/webp"
                    } else {
                        "image/jpeg"
                    };
                    (dir.join(aid).join(f), mime)
                }
                None => return not_found(),
            }
        }
        _ => return not_found(),
    };

    let len = match std::fs::metadata(&file) {
        Ok(m) => m.len(),
        Err(_) => return not_found(),
    };

    // Range 파싱: bytes=start- / bytes=start-end
    let (mut start, mut end) = (0u64, len.saturating_sub(1));
    let mut ranged = false;
    if let Some(v) = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if let Some(spec) = v.strip_prefix("bytes=") {
            let mut it = spec.splitn(2, '-');
            let s = it.next().unwrap_or("");
            let e = it.next().unwrap_or("");
            if let Ok(s) = s.parse::<u64>() {
                start = s.min(len.saturating_sub(1));
                ranged = true;
            }
            if let Ok(e) = e.parse::<u64>() {
                end = e.min(len.saturating_sub(1));
                ranged = true;
            }
        }
    }
    // 청크 캡 — open-ended 요청도 잘라서 응답
    if end - start + 1 > PROTOCOL_CHUNK_CAP {
        end = start + PROTOCOL_CHUNK_CAP - 1;
        ranged = true;
    }

    let count = (end - start + 1) as usize;
    let mut buf = vec![0u8; count];
    {
        use std::io::{Read, Seek, SeekFrom};
        let mut f = match std::fs::File::open(&file) {
            Ok(f) => f,
            Err(_) => return not_found(),
        };
        if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
            return not_found();
        }
    }

    let mut builder = tauri::http::Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if ranged {
        builder = builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    builder
        .header(header::CONTENT_LENGTH, count.to_string())
        .body(buf)
        .unwrap()
}
