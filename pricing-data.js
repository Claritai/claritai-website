'use strict';
(function(root){
const packages = Object.freeze({
  starter: Object.freeze({id:'starter',label:'Business website',setup:499,monthly:79,description:'A professional website for calls and enquiries.'}),
  catalog: Object.freeze({id:'catalog',label:'Product catalogue',setup:799,monthly:99,description:'Display products and availability, with calls or quote requests instead of checkout.'}),
  store: Object.freeze({id:'store',label:'Online store',setup:999,monthly:129,description:'Sell online with checkout and stock reduced automatically as orders are placed.'}),
  storePlus: Object.freeze({id:'storePlus',label:'Online Store+',setup:1499,monthly:179,description:'A larger store with advanced catalogue, stock and fulfilment requirements.'})
});
const base = packages.starter;
const addons = [
  {
    "id": "google",
    "label": "Get found locally",
    "service": "Google Business Profile setup",
    "setup": 149,
    "monthly": 0,
    "tag": "ONE-OFF",
    "outcome": "Help nearby customers find the right details about your business.",
    "items": [
      "One eligible location: setup or tidy-up",
      "Categories, services, contact details & website link",
      "Verification guidance and handover"
    ],
    "note": "Google Business Profile itself is free. You pay us for setup work. Verification and rankings are controlled by Google.",
    "group": "start"
  },
  {
    "id": "booking",
    "label": "Take bookings online",
    "service": "Simple online booking",
    "setup": 149,
    "monthly": 9,
    "tag": "SAVE ADMIN TIME",
    "outcome": "Let customers choose a time without the back-and-forth.",
    "items": [
      "One calendar, one appointment type",
      "Booking page embedded on your website",
      "Connection checks & booking support"
    ],
    "note": "Uses a free scheduling plan; the €9 covers our support. Multi-staff booking, payments and SMS are excluded. Paid tools only by agreement.",
    "group": "start"
  },
  {
    "id": "reviews",
    "label": "Make reviews easier",
    "service": "Review request kit",
    "setup": 99,
    "monthly": 0,
    "tag": "ONE-OFF",
    "outcome": "Give happy customers a simple way to leave an honest review.",
    "items": [
      "Your Google review link & website button",
      "Print-ready QR card design",
      "Two reusable review-request templates"
    ],
    "note": "You send the requests. Printing and automated sending are excluded. No review incentives or filtering.",
    "group": "start"
  },
  {
    "id": "page",
    "label": "Tell them a little more",
    "service": "Additional website page",
    "setup": 99,
    "monthly": 0,
    "tag": "ONE-OFF",
    "outcome": "Give an extra service, location or your story its own page.",
    "items": [
      "One page within your agreed website design",
      "Up to 500 words of text supplied by you",
      "Mobile layout & search basics"
    ],
    "note": "Price is per page. Includes one revision round; custom tools and full copywriting are excluded.",
    "quantity": 5,
    "unit": "page",
    "group": "start"
  },
  {
    "id": "mailbox",
    "label": "Give your team an email",
    "service": "Additional business mailbox",
    "setup": 0,
    "monthly": 5,
    "tag": "PER MAILBOX",
    "outcome": "Another proper business inbox for another member of your team.",
    "items": [
      "5 GB mailbox on your existing domain",
      "Account setup & routine support",
      "Works with your included email service"
    ],
    "note": "Two mailboxes are already included in the starter. This adds more. Microsoft 365 and Google Workspace licences are excluded.",
    "quantity": 8,
    "unit": "mailbox",
    "group": "grow"
  },
  {
    "id": "seo",
    "label": "Keep improving local search",
    "service": "Local SEO care",
    "setup": 0,
    "monthly": 149,
    "tag": "MONTHLY SERVICE",
    "outcome": "Keep your existing website and local profile useful and up to date.",
    "items": [
      "Improve one existing page each month",
      "One Google Business Profile update",
      "Monthly search report & next actions"
    ],
    "note": "Requires an existing verified profile; if you need one, add the €149 setup. New pages cost extra. No ranking or lead guarantees.",
    "group": "grow"
  },
  {
    "id": "social",
    "label": "Keep showing up on social",
    "service": "Social content essentials",
    "setup": 0,
    "monthly": 199,
    "tag": "MONTHLY SERVICE",
    "outcome": "Stay visible without finding time to create every post yourself.",
    "items": [
      "Four original static posts per month",
      "Captions & scheduling on Facebook + Instagram",
      "One feedback round; approval before publishing"
    ],
    "note": "Four pieces of content, adapted across two channels. You supply photos and offers. Reels, shoots, DMs and paid ads are excluded.",
    "group": "grow"
  },
  {
    "id": "email",
    "label": "Stay in touch by email",
    "service": "Email marketing starter",
    "setup": 149,
    "monthly": 29,
    "tag": "BUILD YOUR LIST",
    "outcome": "Start a permission-based mailing list you can grow over time.",
    "items": [
      "Signup form, branded template & welcome email",
      "500 active subscribers; 5,000 sends/mo; tool included",
      "Connection checks & routine support"
    ],
    "note": "You write and send campaigns. Larger lists, campaign management and store automations are priced separately before upgrading.",
    "group": "grow"
  },
  {
    "id": "ads",
    "label": "Run a focused Meta campaign",
    "service": "Meta ads management",
    "setup": 199,
    "monthly": 199,
    "tag": "AD SPEND SEPARATE",
    "outcome": "Get help planning and managing one clear advertising offer.",
    "items": [
      "One campaign on your own Meta ad account",
      "Two static ad creatives; weekly checks",
      "Monthly report; manage up to €1,500 ad spend"
    ],
    "note": "Advertising budget is paid directly to Meta and is NOT in the package total. You choose it separately before starting. No sales guarantees.",
    "group": "grow"
  },
  {
    "id": "dashboard",
    "label": "See your website performance",
    "service": "Website performance dashboard",
    "setup": 299,
    "monthly": 39,
    "tag": "OPTIONAL REPORTING",
    "outcome": "Make sense of the visits and enquiries your website receives.",
    "items": [
      "One Google Analytics connection",
      "Up to six agreed website metrics",
      "Dashboard maintenance & connection checks"
    ],
    "note": "Sales, stock, accounting, ad-platform connectors and custom reporting are excluded. Consent and access are agreed before setup.",
    "group": "grow"
  }
];
function calculate(choices={}, packageId='starter') {
 const selectedPackage=packages[packageId] || packages.starter;
 const rows=[{id:selectedPackage.id,label:selectedPackage.label,quantity:1,setup:selectedPackage.setup,monthly:selectedPackage.monthly}];
 for(const a of addons){const n=Number(choices[a.id] || 0);if(!Number.isInteger(n) || n<0 || n>(a.quantity || 1)) throw new RangeError('Invalid quantity for '+a.id);if(n)rows.push({id:a.id,label:a.service,quantity:n,setup:a.setup*n,monthly:a.monthly*n});}
 const setup=rows.reduce((n,r)=>n+r.setup,0);const monthly=rows.reduce((n,r)=>n+r.monthly,0);return {rows,setup,monthly,firstYear:setup+12*monthly,hasAdSpend:rows.some(r=>r.id==='ads')};
}
const api=Object.freeze({base,packages,addons,calculate});
if(typeof module==='object' && module.exports) module.exports=api;else root.ClaritaiPricing=api;
})(typeof globalThis!=='undefined'?globalThis:this);
