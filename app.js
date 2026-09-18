'use strict';

// When this page was opened. Desk refuses any enquiry that arrives faster than a
// person could plausibly have filled the form in, and treats a missing value as
// suspicious — so this has to be sent, not omitted.
const CLARITAI_PAGE_OPENED = Date.now();


const money = value => new Intl.NumberFormat('en-IE', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0}).format(value);
const integer = value => new Intl.NumberFormat('en-IE', {maximumFractionDigits: 0}).format(value);
const query = (selector, root = document) => root.querySelector(selector);
const queryAll = (selector, root = document) => [...root.querySelectorAll(selector)];

// All business values below are invented demonstration data, never live customer results.
const businessData = {
  retail: {
    connections: 'Shopify · Google Analytics · Meta · Xero',
    chartLabel: 'Revenue',
    month: {
      metrics: [
        {label: 'Revenue', value: 24860, previous: 21000, type: 'money'},
        {label: 'Orders', value: 412, previous: 356, type: 'integer'},
        {label: 'Returning customers', value: 34, previous: 30, type: 'percent'},
        {label: 'Stock alerts', value: 3, type: 'integer', note: 'Items to review', neutral: true}
      ],
      values: [5100, 5900, 6440, 7420],
      insight: 'Your best seller needs a stock check.',
      description: '3 products are below their example reorder levels. Check stock before your next promotion.',
      footnote: 'Example priority from combined sales and inventory data.'
    },
    quarter: {
      metrics: [
        {label: 'Revenue', value: 70280, previous: 58850, type: 'money'},
        {label: 'Orders', value: 1184, previous: 992, type: 'integer'},
        {label: 'Returning customers', value: 32, previous: 28, type: 'percent'},
        {label: 'Stock alerts', value: 5, type: 'integer', note: 'Items flagged in period', neutral: true}
      ],
      values: [21880, 23540, 24860],
      insight: 'Repeat customers are coming back.',
      description: 'Returning customers make up 32% of orders in this example. Review your follow-up emails to keep that relationship growing.',
      footnote: 'Example priority from customer and order data.'
    }
  },
  local: {
    connections: 'Bookings · Google Business Profile · POS · Accounting',
    chartLabel: 'Sales',
    month: {
      metrics: [
        {label: 'Sales', value: 16400, previous: 14900, type: 'money'},
        {label: 'Customer enquiries', value: 86, previous: 71, type: 'integer'},
        {label: 'Bookings', value: 41, previous: 35, type: 'integer'},
        {label: 'Avg. response time', value: 2.1, previous: 3.4, type: 'hours', lowerIsBetter: true}
      ],
      values: [3100, 3700, 4600, 5000],
      insight: '9 enquiries are waiting for a reply.',
      description: 'A good week for interest. Follow up with the people who have already asked about your business.',
      footnote: 'Example priority from enquiries and booking activity.'
    },
    quarter: {
      metrics: [
        {label: 'Sales', value: 45500, previous: 39700, type: 'money'},
        {label: 'Customer enquiries', value: 245, previous: 202, type: 'integer'},
        {label: 'Bookings', value: 120, previous: 103, type: 'integer'},
        {label: 'Avg. response time', value: 2.8, previous: 3.7, type: 'hours', lowerIsBetter: true}
      ],
      values: [13800, 15300, 16400],
      insight: 'More enquiries. Faster replies.',
      description: 'Enquiries are up and your response time is down in this example. Review which channels are bringing in booked customers.',
      footnote: 'Example priority from enquiries, bookings and sales.'
    }
  },
  service: {
    connections: 'CRM · Website enquiries · Google Analytics · Accounting',
    chartLabel: 'Quoted work',
    month: {
      metrics: [
        {label: 'Open pipeline', value: 84750, previous: 71800, type: 'money'},
        {label: 'Qualified leads', value: 37, previous: 31, type: 'integer'},
        {label: 'Quotes sent', value: 42300, previous: 38200, type: 'money'},
        {label: 'Overdue invoices', value: 6800, type: 'money', note: 'Follow-up needed', neutral: true}
      ],
      values: [7900, 12400, 8700, 13300],
      insight: '5 warm leads need a follow-up.',
      description: 'These prospects have received a quote but have not replied yet. A timely conversation could help move things forward.',
      footnote: 'Example priority from lead stages and quotation dates.'
    },
    quarter: {
      metrics: [
        {label: 'Pipeline created', value: 215600, previous: 190400, type: 'money'},
        {label: 'Qualified leads', value: 109, previous: 91, type: 'integer'},
        {label: 'Quotes sent', value: 121500, previous: 103200, type: 'money'},
        {label: 'Overdue invoices', value: 6200, type: 'money', note: 'At end of period', neutral: true}
      ],
      values: [36000, 43200, 42300],
      insight: 'A healthy pipeline still needs attention.',
      description: 'You have sent €121,500 in quotes in this example. Review the oldest open quotes and overdue invoices together.',
      footnote: 'Quoted work is potential business, not collected revenue.'
    }
  }
};

let activeBusiness = 'retail';
function metricValue(metric) {
  if (metric.type === 'money') return money(metric.value);
  if (metric.type === 'percent') return metric.value + '%';
  if (metric.type === 'hours') return metric.value.toFixed(1) + ' hrs';
  return integer(metric.value);
}
function metricChange(metric) {
  if (metric.previous == null) return {value: metric.note || '', context: '', neutral: true};
  const delta = metric.value - metric.previous;
  const percent = delta / metric.previous * 100;
  const value = metric.type === 'percent'
    ? `${delta >= 0 ? '+' : ''}${delta} pp`
    : `${delta >= 0 ? '↗' : '↘'} ${Math.abs(percent).toFixed(1)}%`;
  return {value, context: 'vs prior period', neutral: metric.lowerIsBetter ? delta > 0 : delta < 0};
}
function renderChart(values, metricName, period) {
  const width = 560;
  const height = 155;
  const padding = 7;
  const max = Math.ceil(Math.max(...values) / 2000) * 2000;
  const coords = values.map((value, index) => [padding + index * ((width - padding * 2) / (values.length - 1)), height - padding - (value / max) * (height - padding * 2)]);
  const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width - padding},${height} L${padding},${height} Z`;
  const labels = values.map((_, index) => `${period === 'month' ? 'Week' : 'Month'} ${index + 1}`);
  const grid = [0, 1, 2, 3].map(n => `<line x1="0" y1="${padding + n * (height - padding * 2) / 3}" x2="${width}" y2="${padding + n * (height - padding * 2) / 3}" stroke="#e9edf5" stroke-dasharray="3 5"/>`).join('');
  const scale = [max, max * 2 / 3, max / 3, 0].map(v => `<span>€${v === 0 ? '0' : (v / 1000).toFixed(1).replace('.0', '') + 'k'}</span>`).join('');
  const dots = coords.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="#354df4" stroke="white" stroke-width="2"><title>${labels[i]}: ${money(values[i])}</title></circle>`).join('');
  query('#chart').innerHTML = `<div class="chart-scale"><div class="chart-y">${scale}</div><div class="chart-plot"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Illustrative ${metricName.toLowerCase()}: ${values.map((v, i) => `${labels[i]} ${money(v)}`).join(', ')}"><defs><linearGradient id="main-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#354df4" stop-opacity=".17"/><stop offset="1" stop-color="#354df4" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#main-area)"/><path d="${line}" fill="none" stroke="#354df4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dots}</svg></div></div><div class="chart-x">${labels.map(label => `<span>${label}</span>`).join('')}</div>`;
}
function renderDashboard() {
  const period = query('#period').value;
  const business = businessData[activeBusiness];
  const data = business[period];
  query('#metrics').innerHTML = data.metrics.map(metric => {
    const change = metricChange(metric);
    return `<article class="metric"><p>${metric.label}</p><div class="metric-value">${metricValue(metric)}</div><div class="metric-detail${change.neutral ? ' neutral' : ''}"><b>${change.value}</b>${change.context ? `<span>${change.context}</span>` : ''}</div></article>`;
  }).join('');
  query('#chart-heading').textContent = `${business.chartLabel} by ${period === 'month' ? 'week' : 'month'}`;
  query('#chart-legend').textContent = business.chartLabel;
  query('#insight-title').textContent = data.insight;
  query('#insight-description').textContent = data.description;
  query('#insight-footnote').textContent = data.footnote;
  query('#connections').textContent = business.connections;
  renderChart(data.values, business.chartLabel, period);
}
function selectBusiness(button, focus = false) {
  activeBusiness = button.dataset.business;
  queryAll('[data-business]').forEach(tab => {
    const active = tab === button;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  query('#business-panel').setAttribute('aria-labelledby', button.id);
  if (focus) button.focus();
  renderDashboard();
}
queryAll('[data-business]').forEach(button => {
  button.addEventListener('click', () => selectBusiness(button));
  button.addEventListener('keydown', event => {
    const tabs = queryAll('[data-business]');
    const current = tabs.indexOf(button);
    let next;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectBusiness(tabs[next], true); }
  });
});
query('#period').addEventListener('change', renderDashboard);
renderDashboard();

const pricing = globalThis.ClaritaiPricing;
function getPlan() {
  const choices = {};
  queryAll('input[name="addons"]:checked').forEach(input => {
    choices[input.value] = Number(query(`[data-quantity="${input.value}"]`)?.value || 1);
  });
  const packageId = query('input[name="site-model"]:checked')?.value || 'starter';
  return pricing.calculate(choices, packageId);
}
function updatePlan(announce = true) {
  const plan = getPlan();
  queryAll('input[name="addons"]').forEach(input => {
    const card = input.closest('.addon-card');
    card.classList.toggle('is-selected', input.checked);
    query('.toggle-word', card).textContent = input.checked ? 'Added' : 'Add';
    query('.addon-check', card).textContent = input.checked ? '✓' : '+';
    const quantity = query('[data-quantity]', card);
    if (quantity) quantity.disabled = !input.checked;
  });
  query('#monthly-total').textContent = money(plan.monthly);
  query('#one-off-total').textContent = money(plan.setup);
  query('#year-total').textContent = money(plan.firstYear);
  query('#ad-spend-note').hidden = !plan.hasAdSpend;
  query('#reset-plan').hidden = plan.rows.length === 1 && plan.rows[0].id === 'starter';
  query('#mobile-total').innerHTML = `<b>${money(plan.setup)}</b> + ${money(plan.monthly)}/mo`;
  query('#selected-services').innerHTML = plan.rows.map((row, index) => `<div class="package-row"><div><b>${row.label}${row.quantity > 1 ? ` × ${row.quantity}` : ''}</b><span>${row.setup ? money(row.setup) + ' setup' : 'No setup fee'}${row.monthly ? ' + ' + money(row.monthly) + '/mo' : ' · No monthly fee'}</span></div>${index === 0 ? '<span class="row-included">Foundation</span>' : `<button type="button" data-remove-addon="${row.id}" aria-label="Remove ${row.label}">×</button>`}</div>`).join('');
  if (announce) query('#plan-announcement').textContent = `Your package: ${money(plan.setup)} setup, ${money(plan.monthly)} per month. First 12 months ${money(plan.firstYear)}, excluding VAT${plan.hasAdSpend ? ' and Meta advertising spend' : ''}.`;
}
function setExample(id) {
  const starterModel = query('input[name="site-model"][value="starter"]');
  if (starterModel) starterModel.checked = true;
  queryAll('input[name="addons"]').forEach(input => { input.checked = input.value === id; });
  updatePlan();
  query('#plan').scrollIntoView({behavior:'smooth', block:'start'});
}
queryAll('input[name="addons"], [data-quantity]').forEach(input => input.addEventListener('change', () => updatePlan()));
query('#reset-plan').addEventListener('click', () => {setExample('starter');query('input[name="addons"]').focus({preventScroll:true});});
queryAll('[data-example]').forEach(button => button.addEventListener('click', () => setExample(button.dataset.example)));
queryAll('.starter-only').forEach(button => button.addEventListener('click', () => {setExample('starter');openPlanContact(button);}));
query('#selected-services').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-addon]');
  if (!button) return;
  const input=query(`input[name="addons"][value="${button.dataset.removeAddon}"]`);
  input.checked = false;
  updatePlan();
  query('#discuss-plan').focus({preventScroll:true});
});
queryAll('[data-add-addon]').forEach(button => button.addEventListener('click', () => {
  const input = query(`input[name="addons"][value="${button.dataset.addAddon}"]`);
  input.checked = true;
  query('#more-extras').open = true;
  updatePlan();
}));
updatePlan(false);

const menuToggle = query('.menu-toggle');
const mobileNav = query('#mobile-nav');
function closeMenu() {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open menu');
  mobileNav.hidden = true;
}
menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  mobileNav.hidden = !open;
});
queryAll('a', mobileNav).forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
window.matchMedia('(min-width: 961px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

const dialog = query('#contact-dialog');
const form = query('#contact-form');
let lastTrigger;
let enquiryText = '';
let selectedPlan = null;
function openContact(message, trigger) {
  lastTrigger = trigger;
  query('#enquiry-message').value = message;
  form.hidden = false;
  query('#email-ready').hidden = true;
  query('#copy-status').textContent = '';
  closeMenu();
  dialog.showModal();
  document.body.classList.add('modal-open');
  query('input[name="name"]', form).focus();
}
queryAll('[data-contact]').forEach(button => button.addEventListener('click', () => {
  selectedPlan = null;
  openContact(`I’d like to discuss: ${button.dataset.contact.toLowerCase()}.`, button);
}));
function openPlanContact(trigger) {
  const plan = getPlan();
  selectedPlan = plan;
  const lines = plan.rows.map(row => `• ${row.label}${row.quantity > 1 ? ' × ' + row.quantity : ''}: ${money(row.setup)} setup + ${money(row.monthly)}/month`).join('\n');
  const message = `I’d like a fixed quote for this package:\n\n${lines}\n\nTOTAL: ${money(plan.setup)} setup + ${money(plan.monthly)}/month.\nFirst 12 months: ${money(plan.firstYear)} (setup + 12 monthly payments).\nAll prices exclude VAT${plan.hasAdSpend ? ' and advertising spend paid directly to Meta' : ''}. Monthly care starts at launch; recurring add-ons start when activated.\n\nPlease confirm the scope and final price before I decide.\n\nMy business / main goal: `;
  openContact(message, trigger);
}
query('#discuss-plan').addEventListener('click', event => openPlanContact(event.currentTarget));
query('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
dialog.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  if (lastTrigger) lastTrigger.focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const leadEndpoint = String(window.CLARITAI_CONFIG?.leadEndpoint || '').trim();
  data.set('submissionId', crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  data.set('elapsed', String(Date.now() - CLARITAI_PAGE_OPENED));
  if (selectedPlan) {
    data.set('setupTotal', String(selectedPlan.setup));
    data.set('monthlyTotal', String(selectedPlan.monthly));
    data.set('firstYearTotal', String(selectedPlan.firstYear));
    data.set('selectedServices', JSON.stringify(selectedPlan.rows.map(row => ({
      key: row.id,
      label: row.label,
      quantity: row.quantity,
      setup: row.setup,
      monthly: row.monthly
    }))));
    // A plain-text version of the same thing. Desk keeps this as a note on the
    // lead, so whoever picks the enquiry up can read what was chosen without
    // decoding JSON.
    const euro = value => '\u20ac' + Number(value || 0).toLocaleString('en-IE');
    data.set('packageText', [
      // The first row is always the base package; the rest are add-ons.
      selectedPlan.rows.length ? 'Package: ' + selectedPlan.rows[0].label : 'Package built on the site',
      ...selectedPlan.rows.map(row => {
        const qty = row.quantity > 1 ? ' x' + row.quantity : '';
        const bits = [];
        if (row.setup) bits.push(euro(row.setup) + ' setup');
        if (row.monthly) bits.push(euro(row.monthly) + '/mo');
        return '  - ' + row.label + qty + (bits.length ? ' (' + bits.join(', ') + ')' : '');
      }),
      '',
      'Setup total: ' + euro(selectedPlan.setup),
      'Monthly total: ' + euro(selectedPlan.monthly),
      'First year: ' + euro(selectedPlan.firstYear),
      'All excluding VAT.'
    ].join('\n'));
  }
  const name = String(data.get('name')).trim();
  const email = String(data.get('email')).trim();
  const company = String(data.get('company')).trim();
  const message = String(data.get('message')).trim();
  if (!name || !company || !message) {
    const field = !name ? query('[name="name"]', form) : !company ? query('[name="company"]', form) : query('[name="message"]', form);
    field.setCustomValidity('Please add a little detail here.');
    field.reportValidity();
    field.addEventListener('input', () => field.setCustomValidity(''), {once: true});
    return;
  }
  enquiryText = `Hi Claritai,\n\n${message}\n\nBusiness: ${company}\nName: ${name}\nEmail: ${email}\n\nPrepared using the Claritai package review. Please confirm scope, VAT, payment schedule and final terms before accepting an order.`;
  const subject = `Claritai enquiry — ${company.replace(/[\r\n]+/g, ' ')}`;
  query('#email-link').href = `mailto:info@claritai.ie?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(enquiryText)}`;
  query('#enquiry-preview').value = enquiryText;
  const submitButton = query('button[type="submit"]', form);
  const originalLabel = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';
  try {
    if (!leadEndpoint) throw new Error('Lead endpoint is not configured');
    const response = await fetch(leadEndpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.fromEntries(data.entries()))
    });
    if (!response.ok) throw new Error('Enquiry submission failed');
    form.hidden = true;
    query('#email-ready').hidden = false;
    query('#enquiry-result-title').textContent = 'Thanks — we have your enquiry.';
    query('#enquiry-result-copy').textContent = 'We’ll review it and come back to you shortly with the next step.';
    query('#email-link').hidden = true;
    query('#copy-enquiry').hidden = true;
    query('#enquiry-fallback').hidden = true;
    query('#edit-enquiry').textContent = 'Send another enquiry';
    query('#edit-enquiry').focus();
    form.reset();
    selectedPlan = null;
  } catch {
    form.hidden = true;
    query('#email-ready').hidden = false;
    query('#enquiry-result-title').textContent = 'Your enquiry is ready to send.';
    query('#enquiry-result-copy').textContent = 'We couldn’t submit it automatically. Open the prepared email draft, then review and send it to info@claritai.ie.';
    query('#email-link').hidden = false;
    query('#copy-enquiry').hidden = false;
    query('#enquiry-fallback').hidden = false;
    query('#edit-enquiry').textContent = 'Back to edit';
    query('#email-link').focus();
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalLabel;
  }
});
query('#copy-enquiry').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(enquiryText);
    query('#copy-status').textContent = 'Copied. Paste it into an email to info@claritai.ie.';
  } catch {
    query('#email-ready details').open = true;
    query('#enquiry-preview').focus();
    query('#enquiry-preview').select();
    query('#copy-status').textContent = 'Select and copy the enquiry below, then email info@claritai.ie.';
  }
});
query('#edit-enquiry').addEventListener('click', () => {
  form.hidden = false;
  query('#email-ready').hidden = true;
  query('#enquiry-message').focus();
});
