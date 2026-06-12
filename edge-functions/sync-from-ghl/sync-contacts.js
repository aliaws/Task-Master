export async function syncContact(sql, ghlContactId) {
  console.log("[sync-contacts] triggered with ghlContactId:", ghlContactId);

  if (!ghlContactId) {
    console.log("[sync-contacts] no ghlContactId provided, skipping");
    return null;
  }

  const rows = await sql`
    SELECT id FROM contacts WHERE ghl_id = ${ghlContactId} LIMIT 1
  `;

  if (rows.length > 0) {
    console.log("[sync-contacts] found contact:", rows[0].id, "for GHL contact ID:", ghlContactId);
    return rows[0].id;
  }

  console.warn("[sync-contacts] no contact found for GHL contact ID:", ghlContactId);
  return null;
}

export async function handleContactCreate(sql, payload) {
  console.log("[sync-contacts] ContactCreate handler called");
  const result = await sql`
    INSERT INTO contacts ${sql({
      ghl_id: payload.id,
      first_name: payload.firstName || null,
      last_name: payload.lastName || null,
      email: payload.email || null,
      phone: payload.phone || null,
      ghl_date_updated: payload.timestamp || null,
      data_source: "engaged",
    })}
    ON CONFLICT (ghl_id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      ghl_date_updated = EXCLUDED.ghl_date_updated
    RETURNING id
  `;
  console.log("[sync-contacts] contact created/updated:", result[0].id);
  return { action: "created", contact_id: result[0].id };
}

export async function handleContactUpdate(sql, payload) {
  console.log("[sync-contacts] ContactUpdate handler called");
  const result = await sql`
    UPDATE contacts SET
      first_name = ${payload.firstName || null},
      last_name = ${payload.lastName || null},
      email = ${payload.email || null},
      phone = ${payload.phone || null},
      ghl_date_updated = ${payload.timestamp || null}
    WHERE ghl_id = ${payload.id}
    RETURNING id
  `;

  if (result.length === 0) {
    console.warn("[sync-contacts] contact not found for update, ghl_id:", payload.id);
    return { action: "updated", warning: "Contact not found", ghl_id: payload.id };
  }

  console.log("[sync-contacts] contact updated:", result[0].id);
  return { action: "updated", contact_id: result[0].id };
}

export async function handleContactDelete(sql, ghlId) {
  console.log("[sync-contacts] ContactDelete handler called");
  const result = await sql`
    DELETE FROM contacts WHERE ghl_id = ${ghlId} RETURNING id
  `;

  if (result.length === 0) {
    console.warn("[sync-contacts] contact not found for deletion, ghl_id:", ghlId);
    return { action: "deleted", warning: "Contact not found", ghl_id: ghlId };
  }

  console.log("[sync-contacts] contact deleted:", result[0].id);
  return { action: "deleted", contact_id: result[0].id };
}
