/*
  売れ筋(おすすめが作れない人の代わりに使う 3 件)
  対象 DE : Reco_Bestsellers(主キー: ListName + Rnk) / 操作: 上書き
  入力    : Order_Lines_13M、Product_Catalog

  - 直近 90 日の販売数の順。茶器・ギフトセットは除く
  - ListName は固定値。メールの LookupOrderedRows で絞り込みの列として使う
*/
SELECT
    'default' AS ListName,
    x.Rnk,
    x.ProductId,
    x.ProductName,
    x.Price,
    x.ProductUrl,
    x.ImageUrl
FROM (
    SELECT
        p.ProductId,
        p.ProductName,
        p.Price,
        p.ProductUrl,
        p.ImageUrl,
        ROW_NUMBER() OVER (ORDER BY SUM(ol.Quantity) DESC, p.ProductId) AS Rnk
    FROM Order_Lines_13M ol
    INNER JOIN Product_Catalog p
        ON p.ProductId = ol.ProductId
    WHERE ol.OrderedAt >= DATEADD(DAY, -90, DATEADD(HOUR, 15, GETDATE()))
      AND p.IsActive = 1
      AND p.Category NOT IN ('Teaware', 'GiftSet')
    GROUP BY p.ProductId, p.ProductName, p.Price, p.ProductUrl, p.ImageUrl
) x
WHERE x.Rnk <= 3
