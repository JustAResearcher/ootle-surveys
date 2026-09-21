# Interface specification

Reference: concept.png (1536 x 1024), adopted in build mode.
White background, #080b2d text, #6e7490 muted text, #7856ef accent, #d7dbea borders.
System sans typography: 50px/1.12 bold heading, 25px subtitle, 26px section heading,
17px labels and controls, 16px explanatory text. Desktop margins 44px; header 74px.
Main two-column form, 2.4fr/1fr, 24px gutter. Bordered panels have 10px radii,
28px inner padding, no shadows. Violet solid primary button. No raster UI assets.

Allowed main copy: ootle surveys; Surveys; Responses; Esmeralda testnet;
Good questions. Fair rewards.; Create a private survey and thank people for their time.;
New questionnaire; Survey title; What would you like to learn?; Introduction;
Tell participants what to expect.; Question 1; Write your question; Short answer;
Required; Add question; Participation reward; 1 tTARI; per approved response;
Invitations; Reward budget; Answers are encrypted for you. Participants receive a
private Ootle payment after approval.; Create survey; Your surveys;
Your first questionnaire starts here.; Your questions and answers stay off-chain.

Functional extensions: unlock/backup vault control; organizer access-code form;
password vault dialog; selectable question types; per-question delete; survey list;
invitation-link dialog; response review and approval state; participant questionnaire;
submission confirmation and payment status. Extend the same visual system.
Mobile: stack editor then reward panel, wrap navigation, 20px outer margin.
Questionnaires are plain React text (no raw HTML rendering), with accessible labels.
No analytics, external fonts, survey content in URLs, or misleading anonymity claims.
