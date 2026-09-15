//! 迁移前自动备份失败的进程内提示槽:setup 阶段数据库已成功打开(迁移完成),
//! 这里把失败原因暂存,主窗加载后由前端取一次并显示在错误条上(取值即清空)。
//! 与启动对话框并存且互补:对话框覆盖「仅托盘启动、主窗从未打开」,错误条覆盖
//! 「用户回到主窗」;两条通道对话框即时可见,错误条供回到主窗后回看,同一会话可能先后各出现一次。
use std::sync::Mutex;

static WARNING: Mutex<Option<String>> = Mutex::new(None);

/// 记下备份失败原因(覆盖旧值:一次启动最多发生一次迁移备份)
pub fn set(reason: &str) {
    if let Ok(mut slot) = WARNING.lock() {
        *slot = Some(reason.to_string());
    }
}

/// 取出并清空(前端启动调用一次;没有警告返回 None)
pub fn take() -> Option<String> {
    WARNING.lock().ok().and_then(|mut slot| slot.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_returns_once_then_none() {
        set("磁盘空间不足");
        assert_eq!(take().as_deref(), Some("磁盘空间不足"));
        assert_eq!(take(), None, "取值即清空,不重复提示");
    }

    #[test]
    fn set_overwrites_previous_reason() {
        set("旧原因");
        set("新原因");
        assert_eq!(take().as_deref(), Some("新原因"));
    }
}
