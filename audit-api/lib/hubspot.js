'use strict';

const { fetchWithTimeout } = require('./util');

// Push the audit lead into HubSpot. Best-effort: never throws to the caller.
// Requires a Private App token (HUBSPOT_TOKEN) with scopes:
//   crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.notes.write
async function pushLead(lead) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return { ok: false, reason: 'no_token' };

  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const [firstname, ...rest] = (lead.name || '').trim().split(/\s+/);
  const lastname = rest.join(' ');

  const properties = {
    email: lead.email,
    firstname: firstname || undefined,
    lastname: lastname || undefined,
    company: lead.company || undefined,
    website: lead.url || undefined,
    phone: lead.phone || undefined,
    lifecyclestage: 'lead',
    hs_lead_status: 'NEW',
  };
  Object.keys(properties).forEach((k) => properties[k] === undefined && delete properties[k]);

  let contactId = null;
  try {
    const createRes = await fetchWithTimeout(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      { method: 'POST', headers, body: JSON.stringify({ properties }) },
      12000
    );
    if (createRes.status === 409) {
      // Contact exists — update by email.
      const updateRes = await fetchWithTimeout(
        'https://api.hubapi.com/crm/v3/objects/contacts/' + encodeURIComponent(lead.email) + '?idProperty=email',
        { method: 'PATCH', headers, body: JSON.stringify({ properties }) },
        12000
      );
      if (updateRes.ok) {
        const j = await updateRes.json();
        contactId = j.id;
      }
    } else if (createRes.ok) {
      const j = await createRes.json();
      contactId = j.id;
    }
  } catch (_) {
    return { ok: false, reason: 'contact_error' };
  }

  if (!contactId) return { ok: false, reason: 'no_contact_id' };

  // Attach the audit result as a timeline note (no custom properties required).
  try {
    const noteBody =
      'Claritai AI Audit\n' +
      'Website: ' + (lead.url || '') + '\n' +
      'Overall score: ' + (lead.score != null ? lead.score + '/100 (' + lead.grade + ')' : 'n/a') + '\n' +
      (lead.summary ? '\n' + lead.summary : '');
    await fetchWithTimeout(
      'https://api.hubapi.com/crm/v3/objects/notes',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: { hs_note_body: noteBody, hs_timestamp: Date.now() },
          associations: [
            {
              to: { id: contactId },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
            },
          ],
        }),
      },
      12000
    );
  } catch (_) {
    // Note is optional; contact was still created.
  }

  return { ok: true, contactId };
}

module.exports = { pushLead };
