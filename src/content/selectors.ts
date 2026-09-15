// Elements where Quest lists instructor names. PeopleSoft element IDs end in
// $<row>. Class search results use MTG_INSTR$n; schedule and cart pages use
// ids containing SSR_INSTR_LONG$n. Best guess until checked against saved pages.
export const INSTRUCTOR_SELECTOR = ['[id^="MTG_INSTR$"]', '[id*="SSR_INSTR_LONG$"]'].join(', ');
