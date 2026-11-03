/*
  1 人ずつのおすすめ商品(最大 3 件)
  対象 DE : Reco_PerSubscriber(主キー: SubscriberKey + Rnk) / 操作: 上書き
  入力    : Customer_FavoriteCategory(01 の結果)、Product_Catalog、Order_Lines_13M
  使う所  : ジャーニーのメール(LookupOrderedRows で Rnk の順に 3 件)

  - 好きな茶の種類のうち、販売中で、直近 13 か月にその人が買っていない商品
  - 直近 90 日によく売れている順。同じなら商品コード順(毎回同じ結果になるように)
  - 1 件も作れない人は、メール側で売れ筋(03 の結果)に切り替える
*/
SELECT
    r.SubscriberKey,
    r.Rnk,
    r.ProductId,
    r.ProductName,
    r.Price,
    r.ProductUrl,
    r.ImageUrl
FROM (
    SELECT
        f.SubscriberKey,
        p.ProductId,
        p.ProductName,
        p.Price,
        p.ProductUrl,
        p.ImageUrl,
        ROW_NUMBER() OVER (
            PARTITION BY f.SubscriberKey
            ORDER BY ISNULL(pop.Qty90d, 0) DESC, p.ProductId
        ) AS Rnk
    FROM Customer_FavoriteCategory f
    INNER JOIN Product_Catalog p
        ON p.Category = f.FavoriteCategory
       AND p.IsActive = 1
    LEFT JOIN (
        SELECT ProductId, SUM(Quantity) AS Qty90d
        FROM Order_Lines_13M
        WHERE OrderedAt >= DATEADD(DAY, -90, DATEADD(HOUR, 15, GETDATE()))
        GROUP BY ProductId
    ) pop
        ON pop.ProductId = p.ProductId
    WHERE NOT EXISTS (
        SELECT 1
        FROM Order_Lines_13M ol
        WHERE ol.SubscriberKey = f.SubscriberKey
          AND ol.ProductId = p.ProductId
    )
) r
WHERE r.Rnk <= 3
