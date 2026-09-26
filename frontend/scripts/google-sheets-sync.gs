/**
 * Openhouse visit bookings → Google Sheet (every 5 minutes)
 * ---------------------------------------------------------
 * Pulls rows from https://bookvisit.openhouse.in/api/export/bookings and upserts them into the
 * "Bookings" tab, keyed by booking id. Incremental: only rows changed since the last run are fetched.
 *
 * ONE-TIME SETUP
 * 1. Open the Google Sheet → Extensions → Apps Script. Delete any code there and paste this whole file.
 * 2. Project Settings (gear icon) → Script Properties → add:
 *      EXPORT_API_KEY   = the value of EXPORT_API_KEY from Vercel (never paste it into this code)
 *      API_BASE         = https://bookvisit.openhouse.in        (optional, this is the default)
 *      SHEET_NAME       = Bookings                              (optional, this is the default)
 * 3. Select the function `setup` in the toolbar and press Run. Approve the permissions
 *    ("connect to an external service" and "see, edit, create your spreadsheets").
 *    This writes the header row, does the first full pull, and installs the 5-minute trigger.
 *
 * DAY TO DAY
 * - `syncBookings` runs automatically every 5 minutes. Check Executions (left sidebar) for logs.
 * - `resetSync` clears the cursor and re-pulls everything (use it if the sheet was edited by hand and
 *   you want it rebuilt). It does not delete rows; it rewrites every known booking in place.
 * - `removeTriggers` stops the schedule.
 */

var COLUMNS = ['id', 'created_at', 'updated_at', 'status', 'name', 'phone', 'email', 'city', 'configuration', 'budget', 'areas', 'visit_when',
  'amount_inr', 'paid_at', 'paid_via', 'razorpay_order_id', 'razorpay_payment_id', 'phone_verified_at', 'whatsapp_message_id', 'whatsapp_error',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'page_url', 'referrer', 'is_test', 'notes'];
var HEADERS = ['Booking ID', 'Created', 'Updated', 'Status', 'Name', 'Phone', 'Email', 'City', 'Configuration', 'Budget', 'Areas', 'Visit when',
  'Amount (₹)', 'Paid at', 'Paid via', 'Razorpay order', 'Razorpay payment', 'Phone verified at', 'WhatsApp msg id', 'WhatsApp error',
  'UTM source', 'UTM medium', 'UTM campaign', 'UTM term', 'UTM content', 'Source', 'Page URL', 'Referrer', 'Test?', 'Notes'];
var DATE_COLUMNS = { created_at: 1, updated_at: 1, paid_at: 1, phone_verified_at: 1 };
var PAGE_SIZE = 500;
var CURSOR_KEY = 'LAST_UPDATED_AT';

function cfg_() {
  var p = PropertiesService.getScriptProperties();
  var key = p.getProperty('EXPORT_API_KEY');
  if (!key) throw new Error('Script property EXPORT_API_KEY is not set (Project Settings → Script Properties).');
  return {
    key: key,
    base: (p.getProperty('API_BASE') || 'https://bookvisit.openhouse.in').replace(/\/$/, ''),
    sheetName: p.getProperty('SHEET_NAME') || 'Bookings',
    props: p,
  };
}

function sheet_(c) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(c.sheetName) || ss.insertSheet(c.sheetName);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function fetchPage_(c, after) {
  var url = c.base + '/api/export/bookings?limit=' + PAGE_SIZE + (after ? '&updated_after=' + encodeURIComponent(after) : '');
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + c.key }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Export API returned HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

// Convert one API row into a sheet row (dates become real Date objects so the sheet formats them in its own timezone).
function toSheetRow_(r) {
  return COLUMNS.map(function (k) {
    var v = r[k];
    if (v === null || v === undefined) return '';
    if (DATE_COLUMNS[k]) return new Date(v);
    if (k === 'is_test') return v ? 'yes' : '';
    return v;
  });
}

/** Main job — runs every 5 minutes. Safe to run by hand any time. */
function syncBookings() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('Another sync is still running; skipping.'); return; }
  try {
    var c = cfg_();
    var sh = sheet_(c);
    var after = c.props.getProperty(CURSOR_KEY) || '';
    // Overlap the cursor by 2 seconds so a row saved in the same second as the last run is never missed;
    // upserting by id makes the overlap harmless.
    if (after) after = new Date(new Date(after).getTime() - 2000).toISOString();

    // Map booking id → sheet row number (1-based) for upserts.
    var lastRow = sh.getLastRow();
    var index = {};
    if (lastRow > 1) {
      var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (ids[i][0]) index[String(ids[i][0])] = i + 2;
    }

    var total = 0, updated = 0, appended = [], newest = c.props.getProperty(CURSOR_KEY) || null, pages = 0;
    while (true) {
      var page = fetchPage_(c, after);
      pages++;
      page.rows.forEach(function (r) {
        total++;
        var row = toSheetRow_(r);
        if (index[r.id]) {
          sh.getRange(index[r.id], 1, 1, COLUMNS.length).setValues([row]);
          updated++;
        } else {
          appended.push(row);
          index[r.id] = lastRow + appended.length; // provisional; rows are appended in this order below
        }
      });
      if (page.next_after && (!newest || page.next_after > newest)) newest = page.next_after;
      if (!page.has_more || pages >= 40) break;
      after = page.next_after;
    }
    if (appended.length) {
      sh.getRange(lastRow + 1, 1, appended.length, COLUMNS.length).setValues(appended);
    }
    if (newest) c.props.setProperty(CURSOR_KEY, newest);
    Logger.log('Synced ' + total + ' changed row(s): ' + appended.length + ' new, ' + updated + ' updated. Cursor: ' + (newest || 'none'));
  } finally {
    lock.releaseLock();
  }
}

/** Run once: header row, first full pull, and the 5-minute trigger. */
function setup() {
  var c = cfg_();
  sheet_(c);
  removeTriggers();
  ScriptApp.newTrigger('syncBookings').timeBased().everyMinutes(5).create();
  syncBookings();
  Logger.log('Setup complete. syncBookings will run every 5 minutes.');
}

/** Forget the cursor and re-pull every booking (rows are rewritten in place, nothing is deleted). */
function resetSync() {
  PropertiesService.getScriptProperties().deleteProperty(CURSOR_KEY);
  syncBookings();
}

/** Stop the schedule. */
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncBookings') ScriptApp.deleteTrigger(t); });
}
