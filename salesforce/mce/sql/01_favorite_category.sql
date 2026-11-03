/*
  好きな茶の種類(直近 13 か月の購入金額がいちばん多い種類)
  対象 DE : Customer_FavoriteCategory(主キー: SubscriberKey) / 操作: 上書き
  入力    : Order_Lines_13M(EC の注文明細。毎朝 EC から取り込む。日時は日本時間)、Product_Catalog
  使う所  : 02_recommendations.sql、メールの差し込み

  - ギフトの注文と、茶器・ギフトセットは「好み」に入れない(贈り物は本人の好みとは限らないため)
  - 金額が同じなら、最近買った種類を優先する
  - MCE の GETDATE() は米国中部標準時(UTC-6、夏時間なし)。日本時間は +15 時間
*/
SELECT
    x.SubscriberKey,
    x.Category AS FavoriteCategory,
    x.CategoryLabel AS FavoriteCategoryLabel,
    x.CategoryAmount,
    DATEADD(HOUR, 15, GETDATE()) AS UpdatedAt
FROM (
    SELECT
        ol.SubscriberKey,
        p.Category,
        p.CategoryLabel,
        SUM(ol.Amount) AS CategoryAmount,
        ROW_NUMBER() OVER (
            PARTITION BY ol.SubscriberKey
            ORDER BY SUM(ol.Amount) DESC, MAX(ol.OrderedAt) DESC
        ) AS rn
    FROM Order_Lines_13M ol
    INNER JOIN Product_Catalog p
        ON p.ProductId = ol.ProductId
    WHERE ol.IsGift = 0
      AND p.Category NOT IN ('Teaware', 'GiftSet')
    GROUP BY ol.SubscriberKey, p.Category, p.CategoryLabel
) x
WHERE x.rn = 1
