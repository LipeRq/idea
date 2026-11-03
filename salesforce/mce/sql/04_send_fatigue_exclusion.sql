/*
  送りすぎの防止:直近 7 日に販促メールを 3 通以上受け取った人
  対象 DE : Exclusion_Fatigue7d(主キー: SubscriberKey) / 操作: 上書き
  入力    : データビュー _Sent、_Job
  使う所  : 販促メールの送信の除外リスト、ジャーニーの判定

  - 取引メール(注文確認など。メールの名前が TX_ で始まる)は数えない。LIKE の _ は 1 文字の意味になるので [_] と書く
  - データビューの EventDate も GETDATE() と同じ米国中部標準時なので、そのまま比べてよい
  - データビューは直近 6 か月分しか残らない
*/
SELECT
    s.SubscriberKey,
    COUNT(*) AS Sends7d
FROM _Sent s
INNER JOIN _Job j
    ON j.JobID = s.JobID
WHERE s.EventDate >= DATEADD(DAY, -7, GETDATE())
  AND j.EmailName NOT LIKE 'TX[_]%'
GROUP BY s.SubscriberKey
HAVING COUNT(*) >= 3
