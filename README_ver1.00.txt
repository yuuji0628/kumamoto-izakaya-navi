KUMAMOTO IZAKAYA NAVI ver1.00

初期サイト一式です。

収録ページ
- index.html                 トップページ
- izakayas.html              居酒屋一覧・検索
- shop.html                  店舗詳細
- areas.html                 熊本県45市町村
- jobs.html                  求人
- listing-form.html          店舗掲載申込み
- contact.html               お問い合わせ
- style.css / script.js
- logo-emblem.jpg            ヘッダー用ロゴ
- logo-official.jpg          確定ロゴ
- header-reference.jpg       ヘッダーデザイン基準

ver1.00の動作
- スマホ対応
- 黒/濃紺 + 金
- 45市町村検索
- 居酒屋ジャンル検索
- 特徴（個室/飲み放題/宴会/深夜営業）検索
- デモ店舗3件で画面確認可能
- /api/shops が利用可能になればAPIデータを優先
- /api/jobs が利用可能になれば求人APIを優先
- 店舗掲載フォームは現時点で端末内保存

次の段階
ver1.01で Cloudflare Worker + 新規D1データベース + 管理画面 + 実際の掲載申込み受信を接続予定。
既存のKUMAMOTO BAR NAVIとはデータベースを分けて運用することを推奨。
