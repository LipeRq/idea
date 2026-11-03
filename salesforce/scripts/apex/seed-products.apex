// しずく茶舗(架空)の商品と、標準価格表の価格(税込)を登録する。
// scripts/generate-data.ts が生成する(手で書き換えない)。商品コードで照合するので、何度実行しても同じ状態になる。
// 実行: sf apex run --file scripts/apex/seed-products.apex --target-org shizuku
Map<String, Product2> products = new Map<String, Product2>{
    'SZK-SEN-001' => new Product2(Name = '煎茶「しずく」100g', ProductCode = 'SZK-SEN-001', IsActive = true, TeaCategory__c = 'Sencha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-SEN-002' => new Product2(Name = '深蒸し煎茶「朝露」100g', ProductCode = 'SZK-SEN-002', IsActive = true, TeaCategory__c = 'Sencha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-SEN-003' => new Product2(Name = '上煎茶「若葉」80g 箱入り', ProductCode = 'SZK-SEN-003', IsActive = true, TeaCategory__c = 'Sencha', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Uchiiwai;Anniversary', CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-SEN-004' => new Product2(Name = '煎茶ティーバッグ 3g×20', ProductCode = 'SZK-SEN-004', IsActive = true, TeaCategory__c = 'Sencha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 365),
    'SZK-DEC-001' => new Product2(Name = 'カフェインレス煎茶 80g', ProductCode = 'SZK-DEC-001', IsActive = true, TeaCategory__c = 'Sencha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Low', ShelfLifeDays__c = 180),
    'SZK-GYO-001' => new Product2(Name = '玉露「翠」50g', ProductCode = 'SZK-GYO-001', IsActive = true, TeaCategory__c = 'Gyokuro', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen;Oseibo;Uchiiwai;Anniversary', CaffeineLevel__c = 'High', ShelfLifeDays__c = 180),
    'SZK-GYO-002' => new Product2(Name = '玉露「霞」100g', ProductCode = 'SZK-GYO-002', IsActive = true, TeaCategory__c = 'Gyokuro', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen;Oseibo;Anniversary', CaffeineLevel__c = 'High', ShelfLifeDays__c = 180),
    'SZK-MAT-001' => new Product2(Name = '抹茶「白鷺」30g缶', ProductCode = 'SZK-MAT-001', IsActive = true, TeaCategory__c = 'Matcha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'High', ShelfLifeDays__c = 120),
    'SZK-MAT-002' => new Product2(Name = '抹茶「千代」40g缶', ProductCode = 'SZK-MAT-002', IsActive = true, TeaCategory__c = 'Matcha', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Oseibo;Anniversary', CaffeineLevel__c = 'High', ShelfLifeDays__c = 120),
    'SZK-MAT-003' => new Product2(Name = '抹茶ラテの素 200g', ProductCode = 'SZK-MAT-003', IsActive = true, TeaCategory__c = 'Matcha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 270),
    'SZK-HOJ-001' => new Product2(Name = 'ほうじ茶「香炉」100g', ProductCode = 'SZK-HOJ-001', IsActive = true, TeaCategory__c = 'Hojicha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-HOJ-002' => new Product2(Name = '棒ほうじ茶 100g', ProductCode = 'SZK-HOJ-002', IsActive = true, TeaCategory__c = 'Hojicha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-HOJ-003' => new Product2(Name = 'カフェインレスほうじ茶 ティーバッグ 2g×20', ProductCode = 'SZK-HOJ-003', IsActive = true, TeaCategory__c = 'Hojicha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Low', ShelfLifeDays__c = 365),
    'SZK-WAK-001' => new Product2(Name = '和紅茶「夕凪」50g', ProductCode = 'SZK-WAK-001', IsActive = true, TeaCategory__c = 'Wakoucha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 365),
    'SZK-WAK-002' => new Product2(Name = '和紅茶ティーバッグ 2.5g×15', ProductCode = 'SZK-WAK-002', IsActive = true, TeaCategory__c = 'Wakoucha', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 365),
    'SZK-TEA-001' => new Product2(Name = '急須(朱泥・300ml)', ProductCode = 'SZK-TEA-001', IsActive = true, TeaCategory__c = 'Teaware', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Uchiiwai;Anniversary', CaffeineLevel__c = null, ShelfLifeDays__c = null),
    'SZK-TEA-002' => new Product2(Name = '湯呑み 2客セット', ProductCode = 'SZK-TEA-002', IsActive = true, TeaCategory__c = 'Teaware', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Uchiiwai;Anniversary', CaffeineLevel__c = null, ShelfLifeDays__c = null),
    'SZK-TEA-003' => new Product2(Name = '茶筒', ProductCode = 'SZK-TEA-003', IsActive = true, TeaCategory__c = 'Teaware', GiftEligible__c = false, NoshiAvailable__c = false, GiftOccasions__c = null, CaffeineLevel__c = null, ShelfLifeDays__c = null),
    'SZK-TEA-004' => new Product2(Name = '抹茶碗と茶筅のセット', ProductCode = 'SZK-TEA-004', IsActive = true, TeaCategory__c = 'Teaware', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Uchiiwai;Anniversary', CaffeineLevel__c = null, ShelfLifeDays__c = null),
    'SZK-GFT-001' => new Product2(Name = '煎茶2種ギフト', ProductCode = 'SZK-GFT-001', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen;Oseibo;Uchiiwai;Anniversary;Novelty', CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-GFT-002' => new Product2(Name = '煎茶・ほうじ茶ティーバッグギフト', ProductCode = 'SZK-GFT-002', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Uchiiwai;Anniversary;Novelty', CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 365),
    'SZK-GFT-003' => new Product2(Name = '玉露と煎茶の詰め合わせ', ProductCode = 'SZK-GFT-003', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen;Oseibo;Anniversary', CaffeineLevel__c = 'High', ShelfLifeDays__c = 180),
    'SZK-GFT-004' => new Product2(Name = '抹茶と茶筅のギフト', ProductCode = 'SZK-GFT-004', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Oseibo;Uchiiwai;Anniversary', CaffeineLevel__c = 'High', ShelfLifeDays__c = 120),
    'SZK-GFT-005' => new Product2(Name = '季節の三種詰め合わせ', ProductCode = 'SZK-GFT-005', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen;Oseibo', CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-GFT-006' => new Product2(Name = 'プチギフト(ティーバッグ3包)', ProductCode = 'SZK-GFT-006', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = false, GiftOccasions__c = 'Uchiiwai;Novelty', CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 365),
    'SZK-GFT-007' => new Product2(Name = 'カフェインレス詰め合わせ', ProductCode = 'SZK-GFT-007', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen;Oseibo;Uchiiwai;Anniversary', CaffeineLevel__c = 'Low', ShelfLifeDays__c = 180),
    'SZK-GFT-008' => new Product2(Name = '名入れ茶缶ギフト', ProductCode = 'SZK-GFT-008', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = false, GiftOccasions__c = 'Anniversary;Novelty', CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-GFT-009' => new Product2(Name = '水出し煎茶ギフト', ProductCode = 'SZK-GFT-009', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen', CaffeineLevel__c = 'Medium', ShelfLifeDays__c = 180),
    'SZK-GFT-010' => new Product2(Name = '極上詰め合わせ', ProductCode = 'SZK-GFT-010', IsActive = true, TeaCategory__c = 'GiftSet', GiftEligible__c = true, NoshiAvailable__c = true, GiftOccasions__c = 'Ochugen;Oseibo;Anniversary', CaffeineLevel__c = 'High', ShelfLifeDays__c = 180)
};
Map<String, Decimal> prices = new Map<String, Decimal>{
    'SZK-SEN-001' => 1620,
    'SZK-SEN-002' => 1944,
    'SZK-SEN-003' => 2700,
    'SZK-SEN-004' => 1080,
    'SZK-DEC-001' => 1728,
    'SZK-GYO-001' => 3240,
    'SZK-GYO-002' => 5400,
    'SZK-MAT-001' => 2160,
    'SZK-MAT-002' => 4320,
    'SZK-MAT-003' => 1296,
    'SZK-HOJ-001' => 1296,
    'SZK-HOJ-002' => 1512,
    'SZK-HOJ-003' => 1404,
    'SZK-WAK-001' => 1620,
    'SZK-WAK-002' => 1188,
    'SZK-TEA-001' => 4950,
    'SZK-TEA-002' => 3850,
    'SZK-TEA-003' => 2750,
    'SZK-TEA-004' => 6600,
    'SZK-GFT-001' => 2700,
    'SZK-GFT-002' => 1620,
    'SZK-GFT-003' => 5400,
    'SZK-GFT-004' => 6480,
    'SZK-GFT-005' => 3780,
    'SZK-GFT-006' => 540,
    'SZK-GFT-007' => 3240,
    'SZK-GFT-008' => 2160,
    'SZK-GFT-009' => 2484,
    'SZK-GFT-010' => 10800
};
for (Product2 existing : [SELECT Id, ProductCode FROM Product2 WHERE ProductCode IN :products.keySet()]) {
    products.get(existing.ProductCode).Id = existing.Id;
}
upsert products.values();

Id standardId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;
Map<Id, Id> entryByProduct = new Map<Id, Id>();
for (PricebookEntry e : [SELECT Id, Product2Id FROM PricebookEntry WHERE Pricebook2Id = :standardId AND Product2.ProductCode IN :products.keySet()]) {
    entryByProduct.put(e.Product2Id, e.Id);
}
List<PricebookEntry> toInsert = new List<PricebookEntry>();
List<PricebookEntry> toUpdate = new List<PricebookEntry>();
for (Product2 p : products.values()) {
    Decimal price = prices.get(p.ProductCode);
    if (entryByProduct.containsKey(p.Id)) {
        toUpdate.add(new PricebookEntry(Id = entryByProduct.get(p.Id), UnitPrice = price, IsActive = true));
    } else {
        toInsert.add(new PricebookEntry(Pricebook2Id = standardId, Product2Id = p.Id, UnitPrice = price, IsActive = true));
    }
}
insert toInsert;
update toUpdate;
System.debug('商品 ' + products.size() + ' 件と標準価格を登録しました');
