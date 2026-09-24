# App Improvement Ideas

Suggested improvements based on the current dashboard, invoice builder, packet wizard, and client pages, listed in priority order.

1. **Save and resume packet drafts.** The invoice builder already autosaves, but the packet wizard keeps its progress in memory. Preserve uploaded invoices, corrections, draw selections, and attachments across refreshes.

2. **Show the invoice beside extracted data.** Add a PDF viewer to the verification step so users can check names, amounts, and line items without switching windows.

3. **Add a packet readiness checklist.** Before generating, identify missing client details, incomplete contractor settings, unavailable templates, and questionable line items—with links to fix each issue.

4. **Preview the finished packet.** Let users inspect generated documents inside the app before downloading, especially page breaks, long descriptions, and filled form fields.

5. **Track individual draws.** Add requested, approved, and paid states for each draw, with dates and outstanding balances alongside the existing client status.

6. **Make the dashboard show what needs attention.** Surface unsigned packets, stalled projects, incomplete drafts, and pending draws. Each item should lead directly to the next action.

7. **Keep packet revisions and activity history.** Record who generated a packet, changed client details, or updated status. Preserve previous versions when documents are regenerated.

8. **Archive and restore records.** Client and invoice deletion currently warns that it’s permanent. Add archiving for finished work and a recoverable trash area for mistakes.

9. **Expand client search and sorting.** The dashboard currently searches by name. Include address, case number, and invoice number, plus sorting by date, value, and last activity.

10. **Show actual generation progress and support retries.** The wizard uses timed progress indicators in places. Track real processing stages and let users retry failures while keeping their verified data.

11. **Replace the catalog with reusable job bundles.** Save manually priced groups of line items and attachments—for example, a bathroom modification package—and add them to invoices. Remove the unused AI invoice-generation and learned-pricing catalog workflows. See [the detailed feature specification](FEATURE_JOB_BUNDLES.md).

12. **Add client notes and follow-up dates.** Keep conversations, next steps, and reminders with the client record so the app supports the work between document generation and completion.

## Recommended Starting Point

Start with **packet draft recovery, side-by-side verification, and the readiness checklist**. They directly reduce lost work and document errors in the core workflow.
