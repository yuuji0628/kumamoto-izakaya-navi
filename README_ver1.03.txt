KUMAMOTO IZAKAYA NAVI ver1.03
管理画面・ログイン・店舗管理

GitHubのmainへZIP内のファイルを追加/上書きしてください。

新機能:
- /admin-login 管理画面ログイン
- 初回アクセス時だけ管理者アカウントを作成
- パスワードはPBKDF2でハッシュ化してD1保存
- ログインセッションはランダムトークンをD1管理（30日）
- /admin 店舗管理
- 店舗の追加 / 編集 / 公開 / 非公開 / 削除
- 店舗掲載申込みが管理画面へ届く
- 掲載申込みを「正式掲載として承認」すると店舗公開
- 公開サイト /api/shops はD1の公開店舗を表示
- /db-status でDB接続状態を確認可能

Cloudflare:
- wrangler.jsonc を追加
- D1 binding "DB" はWranglerの自動プロビジョニングで新規作成
- ASSETS binding で今の静的サイトもそのまま配信
- Secretの手動設定は不要

初回:
1. GitHubへ上書き
2. Cloudflare自動デプロイ完了を待つ
3. https://kumamoto-izakaya-navi.rrwpvwmz8p.workers.dev/admin-login
4. 初回管理者のメールアドレスと10文字以上のパスワードを登録
5. そのままログイン

重要:
- 初回管理者作成は管理者が0人の時だけ有効です。
- パスワードは忘れないように保管してください。
- 写真アップロード/R2は次版で追加予定です。
