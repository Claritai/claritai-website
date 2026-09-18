'use strict';

(() => {
  // The page routing that used to live here is gone: each page is now a real
  // HTML file with its own URL, so the sections are already correct when the
  // document arrives. Leaving it in would re-hide everything and show the home
  // page's sections on every page. What remains is the interactive builder.

  const builder = document.querySelector('#smart-builder');
  if (!builder) return;

  const industries = {
    tractor: {eyebrow:'TRACTOR PARTS & MACHINERY',title:'The right part.<br>Ready when you are.',description:'Browse quality tractor parts and choose the easiest way to order.',products:['Hydraulic pump','PTO shaft','Filter kit'],catalogReason:'Best when customers need to browse parts and stock, but still call you to confirm and order.'},
    retail: {eyebrow:'INDEPENDENT IRISH RETAIL',title:'Products people love.<br>Easy to discover.',description:'Give every product a clear home and make buying straightforward.',products:['Featured product','Customer favourite','New arrival'],catalogReason:'Best when customers browse a range online and contact you before purchasing.'},
    trade: {eyebrow:'LOCAL TRADE SERVICES',title:'Quality work.<br>Clearly explained.',description:'Show customers what you do, where you work and how to request a quote.',products:['Core service','Recent project','Service area'],catalogReason:'A business website is usually the clearest fit for a trade or local service.'},
    professional: {eyebrow:'PROFESSIONAL SERVICES',title:'Expert help.<br>Without the jargon.',description:'Build trust, explain your expertise and turn visits into qualified enquiries.',products:['Service one','Service two','Book a call'],catalogReason:'A focused enquiry website is normally the strongest starting point for professional services.'},
    food: {eyebrow:'FOOD & HOSPITALITY',title:'Worth visiting.<br>Easy to book.',description:'Show the experience, opening hours, menu and the next step customers should take.',products:['Our menu','Book a table','Find us'],catalogReason:'Start with a visual website and add bookings or online ordering when it solves a real need.'}
  };
  const modelCopy = {
    starter: {reason:'Best when the goal is calls, enquiries or bookings rather than displaying a large product range.',button:'Get in touch',stock:'Ask us about this',showCart:false},
    catalog: {reason:null,button:'Check availability',stock:'Call for availability',showCart:false},
    store: {reason:'Best when customers should pay online and stock needs to reduce automatically as orders are placed.',button:'Shop online',stock:'In stock · 12 available',showCart:true},
    storePlus: {reason:'Best for a larger product range, advanced filters, fulfilment rules or more involved stock requirements.',button:'Shop online',stock:'Live stock · Ready to order',showCart:true}
  };

  const businessName = document.querySelector('#builder-business-name');
  const industry = document.querySelector('#builder-industry');
  const featureSearch = document.querySelector('[data-builder-feature="search"]');
  const featureStock = document.querySelector('[data-builder-feature="stock"]');
  const mock = document.querySelector('.site-mock');

  function selectedModel() {
    return document.querySelector('input[name="site-model"]:checked')?.value || 'starter';
  }

  function updateBuilder() {
    const model = selectedModel();
    const details = industries[industry.value];
    const modelDetails = modelCopy[model];
    const price = window.ClaritaiPricing.packages[model];
    const commerce = model === 'store' || model === 'storePlus';
    const hasProducts = model !== 'starter' || ['tractor','retail'].includes(industry.value);

    if (commerce) {
      featureSearch.checked = true;
      featureStock.checked = true;
    }
    featureSearch.disabled = commerce;
    featureStock.disabled = commerce;

    mock.dataset.model = model;
    document.querySelector('#mock-brand').textContent = (businessName.value.trim() || 'YOUR BUSINESS').toUpperCase();
    document.querySelector('#mock-eyebrow').textContent = details.eyebrow;
    document.querySelector('#mock-title').innerHTML = details.title;
    document.querySelector('#mock-description').textContent = details.description;
    document.querySelector('#mock-primary').textContent = modelDetails.button;
    document.querySelector('#mock-cart').hidden = !modelDetails.showCart;
    document.querySelector('.mock-products').hidden = !hasProducts;
    [1,2,3].forEach((number, index) => {
      document.querySelector(`#mock-product-${['one','two','three'][index]}`).textContent = details.products[index];
    });
    document.querySelectorAll('.mock-stock').forEach(label => {
      label.textContent = featureStock.checked ? modelDetails.stock : 'View details';
    });
    document.querySelectorAll('.mock-products button').forEach(button => {
      button.textContent = commerce ? 'Add to basket' : model === 'catalog' ? 'Enquire' : 'Learn more';
    });

    document.querySelector('#builder-package-name').textContent = price.label;
    document.querySelector('#builder-package-reason').textContent = modelDetails.reason || details.catalogReason;
    document.querySelector('#builder-setup-price').textContent = money(price.setup);
    document.querySelector('#builder-monthly-price').textContent = `+ ${money(price.monthly)}/mo`;
    document.querySelector('.base-included b').textContent = `${price.label} foundation`;
    document.querySelector('.base-included p').textContent = `Always included · ${money(price.setup)} setup + ${money(price.monthly)}/month`;
    updatePlan(false);
  }

  businessName.addEventListener('input', updateBuilder);
  industry.addEventListener('change', updateBuilder);
  document.querySelectorAll('input[name="site-model"], [data-builder-feature]').forEach(input => input.addEventListener('change', updateBuilder));
  document.querySelectorAll('input[name="builder-theme"]').forEach(input => input.addEventListener('change', () => {mock.dataset.theme = input.value;}));
  document.querySelectorAll('[data-builder-addon]').forEach(input => input.addEventListener('change', () => {
    const target = document.querySelector(`input[name="addons"][value="${input.dataset.builderAddon}"]`);
    if (target) target.checked = input.checked;
    updatePlan();
  }));
  document.querySelector('#builder-continue').addEventListener('click', () => {
    document.querySelector('#plan').scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(() => document.querySelector('#package-summary').focus({preventScroll:true}), 450);
  });

  updateBuilder();
})();
