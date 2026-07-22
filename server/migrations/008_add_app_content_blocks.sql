CREATE TABLE IF NOT EXISTS app_content_blocks (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_content_blocks_key_check
    CHECK (key IN ('updateAnnouncement', 'help', 'privacy', 'about')),
  CONSTRAINT app_content_blocks_title_check
    CHECK (LENGTH(BTRIM(title)) BETWEEN 1 AND 80),
  CONSTRAINT app_content_blocks_content_check
    CHECK (LENGTH(BTRIM(content)) BETWEEN 1 AND 12000)
);

INSERT INTO app_content_blocks (key, title, content)
VALUES
  (
    'updateAnnouncement',
    '更新公告',
    'Astesia 1.0.0
1. 个人页顶部改为用户信息展示模块，并支持邮箱注册和登录。
2. 登录后可展示头像、用户名、所属计划和 AI 剩余额度。
3. 支持主题、字体、首页布局和个人页背景偏好。
4. 新增本地数据导出、导入、备份、恢复和清理入口。'
  ),
  (
    'help',
    '使用帮助',
    '使用帮助
1. 笔记入口用于记录灵感、备忘和长文本内容，并可在页面底部切换到待办。
2. 记账用于记录收入、支出和消费备注。
3. 待办用于拆解计划和跟踪完成状态。
4. 个人页顶部会根据登录状态展示用户信息卡，未登录时可通过邮箱注册或登录。
5. 注册使用“用户名 + 邮箱 + 验证码”，注册完成后后续使用“邮箱 + 密码”登录。
6. 笔记、记账和待办数据默认保存在本地，建议定期导出或本地备份，避免换机或卸载带来数据丢失。
7. 设置页的数据导出和本地备份可用于换机前的手动备份。'
  ),
  (
    'privacy',
    '隐私说明',
    '隐私说明

Astesia 现在支持用户登录，用于识别当前账号、展示所属计划，并校验 AI 对话相关额度。

目前笔记、账单、待办和外观偏好仍默认保存在当前设备本地，不会因为登录自动上传。

AI 对话记录与 AI 计费摘要会按当前登录用户进行隔离，用于保证额度和会话数据不串用。

卸载 App、清空应用数据或手机损坏仍可能导致本地正式数据丢失，请定期导出或备份。'
  ),
  (
    'about',
    '关于应用',
    'Astesia

一个支持邮箱登录、AI 助手和本地生活管理的笔记、记账、待办 App。'
  )
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS app_content_blocks_updated_at_idx
  ON app_content_blocks (updated_at DESC);
