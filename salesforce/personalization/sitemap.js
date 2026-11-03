/*
 * しずく茶舗(架空)の EC サイトのサイトマップ(Salesforce Interactions SDK)。
 * Salesforce Personalization と Data 360 の Web コネクタで共通に使う。設計は docs/06-personalization.md。
 *
 * 前提(サイト側で用意するもの)
 * - 同意管理ツールの結果を window.shizuku.consent.personalization(true/false)に入れる。同意がなければイベントを送らない
 * - ログイン中は、EC会員ID を window.shizuku.memberId に入れる。メールアドレスや氏名はイベントに載せない
 * - 商品詳細ページの <main> に data-product-id・data-product-name・data-category・data-price・data-gift を付ける
 * - 注文完了ページでは、注文の内容を window.shizuku.order に入れる(id, total, lines[{ productId, quantity, price }])
 *
 * イベント名・項目名・ID の送り方は、Data 360 の Web コネクタに登録したイベントスキーマに合わせる(組織で確認してから公開する)。
 */
(function () {
  "use strict";

  var site = window.shizuku || {};
  var SI = window.SalesforceInteractions;
  if (!SI) return;

  function hasConsent() {
    return !!(site.consent && site.consent.personalization === true);
  }

  function attr(selector, name) {
    var el = document.querySelector(selector);
    return el ? el.getAttribute(name) : null;
  }

  function pathIs(pattern) {
    return function () {
      return pattern.test(window.location.pathname);
    };
  }

  function lineItemFrom(button) {
    var productId = button.getAttribute("data-product-id") || attr("[data-product-id]", "data-product-id");
    if (!productId) return null;
    var quantityInput = document.querySelector("#js-quantity");
    return {
      catalogObjectType: "Product",
      catalogObjectId: productId,
      quantity: Math.max(1, parseInt(quantityInput ? quantityInput.value : "1", 10) || 1),
      price: Number(button.getAttribute("data-price") || attr("[data-product-id]", "data-price")),
      currency: "JPY",
    };
  }

  function orderFromPage() {
    var order = site.order;
    if (!order) return null;
    return {
      id: order.id,
      totalValue: order.total,
      currency: "JPY",
      lineItems: (order.lines || []).map(function (line) {
        return {
          catalogObjectType: "Product",
          catalogObjectId: line.productId,
          quantity: line.quantity,
          price: line.price,
          currency: "JPY",
        };
      }),
    };
  }

  SI.init({
    consents: [
      {
        purpose: SI.ConsentPurpose.Personalization,
        provider: "shizuku-cmp",
        status: hasConsent() ? SI.ConsentStatus.OptIn : SI.ConsentStatus.OptOut,
      },
    ],
  }).then(function () {
    SI.initSitemap({
      global: {
        // ログイン中だけ EC会員ID を付ける(名寄せのキー。Data 360 では「EC会員ID」の Party Identification と同じ値)
        onActionEvent: function (event) {
          if (site.memberId) {
            event.user = event.user || {};
            event.user.identities = event.user.identities || {};
            event.user.identities.ecMemberId = site.memberId;
          }
          return event;
        },
        // 全ページ共通の出し分け枠(P4:法人・大口の相談窓口の案内)
        contentZones: [{ name: "global_corporate_desk", selector: "#js-corporate-desk" }],
      },
      pageTypeDefault: {
        name: "other",
        interaction: { name: "View Page" },
      },
      pageTypes: [
        {
          name: "home",
          isMatch: pathIs(/^\/$/),
          interaction: { name: "View Home" },
          // P1:トップのメイン画像
          contentZones: [{ name: "home_hero", selector: "#js-home-hero" }],
        },
        {
          name: "category",
          isMatch: pathIs(/^\/category\//),
          interaction: {
            name: "View Category",
            catalogObject: {
              type: "Category",
              id: SI.resolvers.fromSelectorAttribute("[data-category-id]", "data-category-id"),
            },
          },
        },
        {
          name: "product_detail",
          isMatch: pathIs(/^\/products\//),
          interaction: {
            name: SI.CatalogObjectInteractionName.ViewCatalogObject,
            catalogObject: {
              type: "Product",
              id: SI.resolvers.fromSelectorAttribute("[data-product-id]", "data-product-id"),
              attributes: {
                name: SI.resolvers.fromSelectorAttribute("[data-product-id]", "data-product-name"),
                category: SI.resolvers.fromSelectorAttribute("[data-product-id]", "data-category"),
                price: SI.resolvers.fromSelectorAttribute("[data-product-id]", "data-price", Number),
                giftEligible: SI.resolvers.fromSelectorAttribute("[data-product-id]", "data-gift"),
              },
            },
          },
          // P2:商品詳細の「この商品を見た方へのおすすめ」
          contentZones: [{ name: "pdp_recommendations", selector: "#js-pdp-recommendations" }],
          listeners: [
            SI.listener("click", ".js-add-to-cart", function (e) {
              var lineItem = lineItemFrom(e.currentTarget || e.target);
              if (!lineItem) return;
              SI.sendEvent({
                interaction: { name: SI.CartInteractionName.AddToCart, lineItem: lineItem },
              });
            }),
          ],
        },
        {
          name: "gift_guide",
          isMatch: pathIs(/^\/gift(\/|$)/),
          interaction: { name: "View Gift Guide" },
        },
        {
          name: "cart",
          isMatch: pathIs(/^\/cart$/),
          interaction: { name: "View Cart" },
          // P3:カートの「送料無料まであと◯円」と、合わせて買われている商品
          contentZones: [{ name: "cart_cross_sell", selector: "#js-cart-cross-sell" }],
        },
        {
          name: "order_complete",
          isMatch: function () {
            return /^\/order\/complete$/.test(window.location.pathname) && !!site.order;
          },
          interaction: {
            name: SI.OrderInteractionName.Purchase,
            order: orderFromPage,
          },
        },
      ],
    });
  });
})();
