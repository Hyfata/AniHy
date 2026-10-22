pub use error::{Error, Result};

mod commands;
mod error;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::AnihyTabs;
#[cfg(mobile)]
use mobile::AnihyTabs;

pub use models::*;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// 플러그인 상태에 접근하는 확장 트레이트.
pub trait AnihyTabsExt<R: Runtime> {
    fn anihy_tabs(&self) -> &AnihyTabs<R>;
}

impl<R: Runtime, T: Manager<R>> AnihyTabsExt<R> for T {
    fn anihy_tabs(&self) -> &AnihyTabs<R> {
        self.state::<AnihyTabs<R>>().inner()
    }
}

/// 플러그인 초기화. 앱 쪽에서는 `tauri_plugin_anihy_tabs::init()`으로 등록.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("anihy-tabs")
        .invoke_handler(tauri::generate_handler![
            commands::set_tabs,
            commands::select_tab,
            commands::get_insets,
            commands::watch_tab_selected,
            commands::watch_insets
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let anihy_tabs = mobile::init(app, api)?;
            #[cfg(desktop)]
            let anihy_tabs = desktop::init(app, api)?;
            app.manage(anihy_tabs);
            Ok(())
        })
        .build()
}
