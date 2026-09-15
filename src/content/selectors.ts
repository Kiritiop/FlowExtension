// Elements where Quest lists instructor names. PeopleSoft element IDs end in
// $<row>. Class search results use MTG_INSTR$n; My Class Schedule uses
// DERIVED_CLS_DTL_SSR_INSTR_LONG$n (confirmed on a saved page). Each field also
// has a win0div wrapper with a similar id, which must not match or names get
// badged twice.
export const INSTRUCTOR_SELECTOR = ['[id^="MTG_INSTR$"]', '[id*="SSR_INSTR_LONG$"]:not([id^="win0div"])'].join(', ');
