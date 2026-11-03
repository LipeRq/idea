/*
  メールへの反応の度合い(配信の頻度を変えるために使う)
  対象 DE : Engagement_Tier(主キー: SubscriberKey) / 操作: 上書き
  入力    : データビュー _Sent、_Open、_Click

  - Active : 90 日以内にクリックあり
  - Warm   : 90 日以内に開封あり(クリックなし)
  - Cold   : 180 日以内に送信があるのに、90 日以内の反応なし → メールマガジンを月 1 回に減らす
  - 開封は Apple のメールのプライバシー保護で実際より多く数えられるため、クリックを重く見る
*/
SELECT
    s.SubscriberKey,
    CASE
        WHEN c.SubscriberKey IS NOT NULL THEN 'Active'
        WHEN o.SubscriberKey IS NOT NULL THEN 'Warm'
        ELSE 'Cold'
    END AS Tier,
    c.LastClick,
    o.LastOpen
FROM (
    SELECT DISTINCT SubscriberKey
    FROM _Sent
    WHERE EventDate >= DATEADD(DAY, -180, GETDATE())
) s
LEFT JOIN (
    SELECT SubscriberKey, MAX(EventDate) AS LastClick
    FROM _Click
    WHERE EventDate >= DATEADD(DAY, -90, GETDATE())
      AND IsUnique = 1
    GROUP BY SubscriberKey
) c
    ON c.SubscriberKey = s.SubscriberKey
LEFT JOIN (
    SELECT SubscriberKey, MAX(EventDate) AS LastOpen
    FROM _Open
    WHERE EventDate >= DATEADD(DAY, -90, GETDATE())
    GROUP BY SubscriberKey
) o
    ON o.SubscriberKey = s.SubscriberKey
