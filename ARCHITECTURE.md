# ARCHITECTURE.md — תכנון הפיצ'רים הבאים

מסמך תכנון בלבד. שום דבר מהחלק הזה לא מומש. המטרה: לבנות בהדרגה, מקומית (localStorage ו-IndexedDB), בלי לשבור נתונים קיימים, ובארכיטקטורה שמאפשרת בעתיד להחליף את שכבת האחסון בשרת בלי לשכתב את הלוגיקה.

## 0. עקרונות

1. **שכבת נתונים אחת.** כל קריאה וכתיבה עוברות דרך `DataStore`. אף קוד אחר לא נוגע ב-`localStorage` או ב-IndexedDB.
2. **אסינכרוני תמיד.** ה-API מחזיר Promise גם כשהאחסון מקומי, כדי שמעבר לשרת לא ישנה את הקוד שקורא.
3. **מזהים, לא שמות.** קשרים בין ישויות הם לפי `id`. כיום מרכז, ענף ומדור נשמרים כטקסט חופשי ומועתקים בין רשומות (ראה סעיף 1.3), ומשם נולדות סתירות.
4. **מקור אמת אחד לכל עובדה.** מה שנגזר לא נשמר.
5. **כל ישות נושאת מטא-דאטה** (`rev`, `updatedAt`, `updatedBy`, `centerId`). זה מה שמאפשר סנכרון, יומן פעולות וזיהוי סתירות.
6. **הכול מתווסף, כלום לא נמחק.** מפתחות storage קיימים נשארים קריאים לאורך כל המיגרציה.

---

## 1. איך הנתונים שמורים היום

### 1.1 מפתחות

כל המפתחות נשמרים כ-`localStorage["hub:<key>"]` (JSON). כשהקובץ רץ בתוך סביבת artifact משתמשים ב-`window.storage` באותם שמות. ההתחברות הנוכחית נשמרת ב-`sessionStorage["hub:session"]`.

| מפתח | תוכן | הערות |
| --- | --- | --- |
| `employees` | מערך עובדים | ראה 1.2 |
| `users` | חשבונות התחברות | `id, username, employeeId, isSuper, active, mustChangePassword, salt, iterations, passwordHash, createdAt, createdBy` |
| `grants` | הרשאות | `id, resource, kind(user/rank), value, grantedBy, scopeRoot, createdAt` |
| `restrictedTabs` | אילו לשוניות מוגבלות | מפה `tab -> bool` |
| `convergencePermissions`, `positionsPermissions` | הרשאות ישנות | מופה ל-`grants` בעת הטעינה (`addLegacy`) |
| `positions` | תקנים | ראה 1.2 |
| `positionsHistory`, `convergenceHistory` | גרסאות קודמות | נוצרות ב-`captureHistory` בכל שמירה של התחום |
| `convergence`, `convergenceAllocations` | רשומות התכנסות והקצאות | ההקצאות לפי ענף ורמה |
| `incentives` | תמריצים | |
| `tasks`, `meetings` | משימות וסיכומי פגישות | תגובות המשימה הן מערך בתוך המשימה |
| `attendance`, `attendanceRequests` | נוכחות ובקשות שינוי | |
| `postings`, `infoItems`, `contactRoles` | שיבוצים, מידע למנהלים, דף קשר | |
| `dashboard`, `dashboardPrefs`, `dashboardLayout` | לוח בקרה | `dashboardLayout` נוסף בסבב האחרון, לפי משתמש |
| `currentUserId` | העובד שמחובר | |

העדפות ממשק (`hubui.theme`, `hubui.nav`) נשמרות ישירות ב-`localStorage`, מחוץ ל-`DataStore` (הן לא נתוני ארגון).

### 1.2 ישויות וקשרים

```
users.employeeId ───────► employees.id          (משתמש הוא עובד)
employees.managerId ────► employees.id          (עץ היררכי)
positions.currentAppointment.linkedEmployeeId ─► employees.id   (הקישור היחיד עובד↔תקן)
positions.futureAppointment.{fullName,personalNumber}           (טקסט בלבד, בלי קישור)
positions.linkedConvergenceId ─► convergence.id
convergence.employeeId ─► employees.id          (אופציונלי; אחרת התאמה לפי שם מלא)
incentives.employeeId ──► employees.id          (+ snapName, צילום שם)
tasks.assignedTo[] / assignedBy / aboutEmployeeIds[] ─► employees.id
tasks.meetingId ────────► meetings.id ; meetings.taskIds[] ─► tasks.id
attendance.employeeId, attendanceRequests.employeeId ─► employees.id
grants.value ───────────► employees.id (kind=user) או דרגה (kind=rank)
grants.scopeRoot ───────► employees.id          (שורש היררכיה)
```

שדות עובד: `name, role, department` (מוצג כעת "מרכז"), `industry` (ענף), `mador` (מדור, חדש), `team` (צוות), `ramad, rank, level, serviceType, managerId, email, phone, startDate, enlistmentDate, compulsoryReleaseDate, unitIntakeDate, personalNumber, grade, professionNumber, professionText, isVolunteer, isCadet, education, flexA, flexB, studies, city, street, notes, active`.

שדות תקן: `serialNumber, jobText, occupationText, profession, grade, seniorityLevel, registrationUnit, counterStatus, freezeStatus, temporality, exemplary, currentAppointment{fullName, personalNumber, releaseDate, linkedEmployeeId}, futureAppointment{fullName, personalNumber, staffingDate}, linkedConvergenceId, regulationNotes, generalNotes`.

שדות התכנסות: `employeeId?, firstName, lastName, role, level, industry, mador, releaseDate, entryDate, exitDate, starred`.

שדות תמריץ: `employeeId, snapName, name, code, gross, startDate, endDate, industry, mador, entered, notes, createdBy, createdAt`. פרטי העובד המוצגים בטבלה (שם, תפקיד, מרכז, דרגה, מספר אישי) נגזרים מהעובד בזמן הציור (`incDerived`).

### 1.3 מה נגזר ומה מועתק (המקור לסתירות)

| עובדה | איפה שמורה היום | סוג |
| --- | --- | --- |
| איזה תקן יש לעובד | רק ב-`position.currentAppointment.linkedEmployeeId`; בכרטיס העובד זה נגזר (`getPositionByEmployeeId`) | מקור יחיד, טוב |
| שם ומספר אישי של המאייש | `position.currentAppointment.fullName/personalNumber` **ובנוסף** `employee.name/personalNumber` | כפילות, מתעדכן רק בשמירת עובד |
| עובד אחד על כמה תקנים | נאכף בשמירה מהטופס, לא בייבוא | `getPositionByEmployeeId` מחזיר את הראשון בלבד |
| תאריך שחרור | `employee.compulsoryReleaseDate` ("שחרור מחובה"), `position.currentAppointment.releaseDate`, `convergence.releaseDate` (ידני). ברירת מחדל בהתכנסות נגזרת מהתקן (`convReleaseInfo`) | **שלושה מקורות** |
| ענף | `employee.industry`, `convergence.industry`, `incentives.industry`, `postings.industry`. בהתכנסות נוצרת מ-`employee.industry \|\| employee.department` ברגע ההוספה | צילום בזמן יצירה, לא קישור |
| מדור | `convergence.mador` ו-`incentives.mador`. ברגע יצירה מרשומת עובד הם מועתקים מ-**`employee.team` (צוות)**, ולא מ-`employee.mador` החדש. רשימת המדורים בטופס התכנסות נבנית מ-`employee.team` | צילום, ובעיית מיפוי שם |
| מרכז | `employee.department` בלבד. תקנים משתמשים ב-`registrationUnit` (טקסט נפרד) | שני שדות טקסט לאותו רעיון |
| מי ראש ענף / מחלקה | נגזר בזמן ריצה מהיררכיית העובדים ומהשדות הטקסטואליים (`getIndustryHeadIds`, `getDepartmentHeadIds`) | תלוי בשם מדויק |
| הרשאות על ענף או מדור | משאב טקסטואלי `conv:industry:<שם>`, `conv:mador:<שם>`, `pos:unit:<שם>` | שינוי שם יתום הרשאות |
| מונה 0/1 מול מספר מאיישים | `counterStatus` טקסט חופשי, בלי חישוב | אין בדיקה |
| קבצים | כ-DataURL בתוך הרשומה (מקסימום 4MB לקובץ) ב-`infoItems`, בתגובות משימה ובבקשות נוכחות | מגביל את מכסת ה-localStorage (כ-5MB לכל המקורות) |

מסקנה לשדה `mador` החדש בעובד: הוא עדיין לא מזין את ההתכנסות והתמריצים. כרגע הוא מועתק בהם `employee.team`. ההחלטה איך לאחד מתוארת בסעיף 8.

---

## 2. שכבת נתונים מרכזית: `DataStore`

### 2.1 ממשק

```
DataStore.collection(name) -> Collection
Collection.get(id)                 -> Promise<Entity|null>
Collection.list({where, order, limit, includeDeleted})  -> Promise<Entity[]>
Collection.put(entity, {actor})    -> Promise<Entity>      // מקצה id, rev, updatedAt, updatedBy
Collection.patch(id, fields, {actor}) -> Promise<Entity>
Collection.remove(id, {actor})     -> Promise<void>        // מחיקה רכה: deletedAt
DataStore.transaction(fn)          -> Promise<T>           // כתיבה אטומית של כמה אוספים
DataStore.on(event, handler)       // 'change', 'sync', 'migration'
DataStore.blobs.put(file) / get(id) / remove(id)           // IndexedDB
DataStore.meta.get('schemaVersion')
```

### 2.2 עקרונות

- **מתאמי אחסון** (`adapter`): `LocalAdapter` (localStorage לנתוני הליבה, IndexedDB לקבצים וליומן) ובעתיד `RemoteAdapter` שמדבר עם שרת. הלוגיקה לא יודעת איזה מהם פעיל.
- **מצב בזיכרון** נשאר כמו היום (`state`), אבל נטען ונכתב דרך `DataStore`. בשלב הראשון `storeGet/storeSet` הקיימים הופכים לעטיפה דקה מעל `DataStore`, כך שאף מסך לא משתנה.
- **היקף (scope)** נאכף ב-`DataStore` ולא במסכים: `list()` מסנן לפי `centerId` של המשתמש הפעיל (סעיף 5).
- **אירועי שינוי** (`on('change')`) מזינים: יומן פעולות, מנוע הסתירות, ציור מחדש ולוח השנה.
- **גרסאות סכמה**: `meta.schemaVersion` + רשימה של מיגרציות (סעיף 7).
- **שמות מפתחות**: האוספים הקיימים נשארים תחת `hub:<name>`. אוספים חדשים נכתבים תחת `hub:<name>` באותו אופן. אוספים כבדים (יומן פעולות, קבצים) נשמרים ב-IndexedDB (`hub-db`).

### 2.3 מעבר לשרת בעתיד

כל `Collection` מתורגם לנקודת קצה (`GET/PUT /api/<collection>`), `rev` הופך לנעילה אופטימית (`If-Match`), `transaction` ל-endpoint אחד, `blobs` להעלאת קבצים, ו-`change` ל-WebSocket או polling. המשתמש הפעיל מגיע מהשרת במקום מ-`sessionStorage`. הסכמות והלוגיקה העסקית (כללי סתירה, כללי לוח שנה) נשארות כמו שהן.

---

## 3. מודל נתונים לישויות חדשות

סימון: `*` חובה. כל ישות כוללת גם `id*, rev*, createdAt*, updatedAt*, updatedBy, centerId, deletedAt?` (הוזכרו פעם אחת כאן).

### 3.1 מרכז ויחידה ארגונית

- **Center** `{ id, name*, kind*: 'hq'|'center', code, active }`. המטה הוא מרכז עם `kind:'hq'`.
- **OrgUnit** `{ id, centerId*, kind*: 'industry'|'mador'|'team', name*, parentId }` עץ: מרכז ← ענף ← מדור ← צוות. מחליף את הטקסט החופשי. שמות היום נהפכים לרשומות ב-מיגרציה (סעיף 7).

### 3.2 תפקיד ואיוש

- **Role** (תפקיד, מבנה ארגוני) `{ id, title*, centerId*, orgUnitId, parentRoleId, level (דרג), positionId?, notes, active }`. תפקיד הוא מקום במבנה; תקן (`positions`) הוא סעיף תקציבי. הקשר: תפקיד אחד מצביע לכל היותר על תקן אחד.
- **Assignment** (איוש לאורך זמן) `{ id, roleId*, employeeId*, kind*: 'current'|'future'|'overlap'|'past', from*, to?, source: 'manual'|'derived' }`. נגזר בשלב המיגרציה מ-`currentAppointment` ו-`futureAppointment`. תאריך סיום נלקח מתאריך השחרור, תאריך התחלה מתאריך הכניסה של המחליף.
- פער איוש = תקופה שבה לתפקיד אין `Assignment` פעיל. חפיפה = שני `Assignment` פעילים בזמן. שניהם **נגזרים** (לא נשמרים).

### 3.3 לוח שנה ותזכורות

- **CalendarItem** מגיע משני מקורות:
  - **נגזר** (לא נשמר): משימה לפי `dueDate`, תזכורת, שחרור (`convergence`/`employee`), כניסה, איוש תפקיד (`Assignment`).
  - **נשמר** `{ id, kind*: 'event'|'manual', title*, start*, end, allDay, eventId?, ownerId, visibility }` לאירועים ופריטים ידניים.
- **Reminder** `{ id, targetType*: 'task'|'calendarItem'|'rule', targetId*, offset*: {unit:'day'|'week'|'month'|'custom', amount}, fireAt*, recipientId*, state*: 'pending'|'fired'|'dismissed' }`. `fireAt` מחושב ונשמר כדי שאפשר יהיה לשאול "מה פג מועדו" בשאילתה אחת.
- **CalendarRule** (משימות אוטומטיות) `{ id, trigger*: {entity:'convergence', field:'releaseDate', offsetDays:-7}, createTask*: {title, assigneeRule, dueOffsetDays}, active, key* }`. **מפתח אי-כפילות**: `ruleId + entityId + תאריך המקור`, כך שאותה משימה לא נוצרת פעמיים, ושינוי תאריך מעדכן אותה במקום ליצור חדשה.
- **UserPref** `{ id, userId*, key*, value }`. בהם `calendar.layers` = רשימת שכבות מופעלות לכל משתמש.

### 3.4 מרכזים, מטה וסנכרון

- **Change** (שינוי מוצע של מרכז) `{ id, entityType*, entityId*, op*: 'create'|'update'|'delete', baseRev*, before, after*, centerId*, status*: 'private'|'submitted'|'approved'|'rejected'|'review', decidedBy?, decidedAt?, note }`.
- **SyncBatch** `{ id, centerId*, scope*: 'hq'|'all', submittedBy*, submittedAt*, changeIds[], status*: 'open'|'closed' }`.
- **Notification** `{ id, recipientId*, kind*: 'sync-review'|'conflict'|'reminder'|'abroad-form'|'task'|'event', title*, payload, state*: 'unread'|'read'|'done', dueAt?, createdAt }`. כללי: משמש את כל סוגי ההתראות, ולכן "התראות שממתינות בכל התחברות" זו שאילתה על `state != 'done'`.

### 3.5 אירועים ויומן פעולות

- **Event** `{ id, title*, start*, end, centerId*, ownerId*, status, description }`.
- **EventStakeholder** `{ id, eventId*, employeeId*, level*: 'view'|'edit'|'manage' }`.
- משימה מקבלת `eventId?`. סינון לוח השנה לפי אירוע זמין רק למי שיש לו `EventStakeholder` או הרשאה.
- **AuditLog** (IndexedDB, מצורף בלבד) `{ id, at*, actorId*, centerId, action*, entityType*, entityId*, before?, after?, eventId?, source: 'ui'|'import'|'sync'|'rule' }`. נכתב אוטומטית מ-`DataStore` על כל `put/patch/remove`, כך שלא תלוי בכל מסך.

### 3.6 טופס חו"ל וקבצים

- **AbroadForm** `{ id, employeeId*, requestedBy*, dateFrom*, dateTo*, destination, fileId*, handlerId*, status*: 'submitted'|'entered'|'returned', returnTaskId?, enteredAt?, enteredBy? }`. כשמוחזר לתיקון נוצרת `Task` רגילה (עם `dueDate`) ו-`returnTaskId` מצביע עליה. סגירת המשימה מחזירה את הטופס ל-`submitted`.
- **FileBlob** (IndexedDB) `{ id, name*, type*, size*, sha256, ownerType*, ownerId*, createdAt, blob }`. הישויות מחזיקות `fileId` ולא DataURL.

### 3.7 כללי סתירה

- **ConflictRule** (מוגדר בקוד כרשימה, לא נשמר) `{ id*, title*, scope: entity types, responsibleKey*, detect(ctx) -> Finding[], fixes[] }`.
- **ConflictFinding** (נשמר) `{ id, ruleId*, fingerprint*, entityRefs[]*, details*, status*: 'open'|'snoozed'|'task'|'ignored'|'resolved', snoozeUntil?, taskId?, firstSeenAt, lastSeenAt, resolvedAt? }`. `fingerprint` יציב (למשל `ruleId + ids ממוינים`) כדי שסתירה שהוגדרה "התעלם" לא תחזור בכל סריקה.
- **Responsibility** `{ id, key*, employeeId*, centerId? }`. מי אחראי על כל `responsibleKey` (למשל `conflicts:position-employee`, `abroad-forms`, `sync-review:convergence`).

### 3.8 שדות להוספה לישויות קיימות

| ישות | שדות חדשים |
| --- | --- |
| כל הישויות | `rev, updatedAt, updatedBy, centerId, deletedAt?` |
| employee | `mador` (קיים), `centerId`, `orgUnitId`/`industryId`/`madorId` (בשלב ה-OrgUnit), `phone` נשאר. השדות הטקסטואליים `department/industry/mador/team` נשארים כגיבוי לקריאה |
| position | `centerId`, `roleId?`, `currentAppointment`/`futureAppointment` נשארים עד סיום המעבר ל-`Assignment` |
| convergence | `centerId`, `syncState`, `hqRev?`; בעתיד `industry/mador` ייגזרו מהעובד כשיש קישור |
| incentive | `centerId` |
| task | `eventId?`, `source` (`manual`/`rule:<id>`/`conflict:<id>`/`abroad:<id>`), `reminders[]` (מזהי תזכורות), `sourceKey?` (מפתח אי-כפילות) |
| attendanceRequest | `fileId` (במקום `file`), `formType` (`status`/`abroad`) |
| user | `scope: {kind:'hq'|'center', centerId}` (משתמש מטה מוגדר `kind:'hq'`) |
| grant | `centerId?` לצורך הרשאות פר-מרכז |

---

## 4. מודל הרשאות

### 4.1 סוגי שחקנים

| שחקן | מה הוא | איך מוגדר |
| --- | --- | --- |
| **משתמש מערכת** | מנהל על. רואה ומנהל הכול, כולל משתמשים, כללים ואחראים | `user.isSuper` (קיים) |
| **מטה** | רואה את כל המרכזים, מקבל התראות סנכרון ומחליט עליהן | `user.scope.kind = 'hq'` |
| **מרכז** | רואה וכותב רק רשומות של המרכז שלו (`centerId`) | `user.scope = {kind:'center', centerId}` |
| **אחראי** | מקבל התראות לפי `Responsibility.key`. לא מקבל בהכרח גישה רחבה | `Responsibility` |
| **בעל עניין באירוע** | רמת גישה לאירוע בודד ולמשימותיו | `EventStakeholder.level` |

### 4.2 עקרונות

- **שתי שכבות נפרדות**: (א) גישה ללשוניות ולמשאבים בשמות כפי שהיום (`canAccess`, `grants`), ו-(ב) **סינון שורות לפי היקף** (`centerId`, היררכיה, אירוע) שמתבצע בתוך `DataStore.list`. הראשונה נשארת, והשנייה חדשה.
- **משאבים חדשים** באותה תבנית טקסטואלית: `calendar:layer:events`, `calendar:layer:occupancy`, `event:<id>`, `sync:approve:<entity>`, `conflicts:rule:<id>`. `grants` הקיים נשאר המנגנון להענקה.
- שכבות לוח שנה של **אירועים** מוצגות רק למי שיש לו `calendar:layer:events` או בעלות באירוע.
- **אחראי ≠ הרשאה**: להיות אחראי על כלל מקבל את ההתראה, ולצפות ברשומות עדיין דורש הרשאה רגילה. אם לאחראי אין גישה לרשומה, ההתראה תציג רק תיאור כללי.
- **הפרדת סימולציה מאבטחה**: כל המשתמשים באותו דפדפן, ולכן כל ההרשאות נאכפות בצד לקוח בלבד. זה מתאים לסימולציה. כשיהיה שרת האכיפה עוברת אליו, וה-`DataStore` ממשיך לסנן רק לנוחות.

---

## 5. מרכזים, מטה וסנכרון

### 5.1 המודל

- **רשומה אחת לכל עובדה**, עם `centerId`. מקור האמת ("ראשי") נשאר באוספים הקיימים.
- שינוי של משתמש מרכז לא נכנס לראשי. הוא נכתב כ-`Change` במצב `private`, והמסך של אותו מרכז מציג "ראשי + השינויים הפרטיים שלי".
- המטה רואה אך ורק את הראשי, ולכן עדכונים פרטיים של מרכזים לא נראים לו עד הסנכרון.
- שמירת השינוי כ-`Change` (ולא עותק מקביל של האוסף) מתאימה ישירות ל-API של שרת (הגשת שינויים) ונותנת diff בחינם.

### 5.2 זרימה

1. מרכז X עורך רשומות התכנסות. נוצרים `Change` פרטיים עם `baseRev` של הראשי.
2. לחיצה על **"סנכרן עם המטה"** או **"סנכרן עם כולם"** מציגה למרכז את הפערים מול הראשי (diff לכל רשומה, כולל שינויים שנעשו בראשי מאז `baseRev`) ומבקשת אישור.
3. אחרי אישור נוצר `SyncBatch`, ה-`Change` עוברים ל-`submitted`, ונוצרת `Notification` מסוג `sync-review` לכל משתמש עם `Responsibility` של `sync-review:convergence` (ולכל משתמשי המטה אם אין אחראי).
4. המטה רואה בכל התחברות: "מרכז X עדכן את ההתכנסות, אלה השינויים". לכל רשומה: **אשר ועדכן**, **דחה**, **בבדיקה**.
5. **אשר** כותב לראשי (`rev` עולה), ה-`Change` עובר ל-`approved`. **דחה** מחזיר למרכז הודעה עם הערה. **בבדיקה** משאיר את ה-`Change` פתוח ושולח למרכז התראה.
6. התנגשות: אם `rev` של הראשי גדל מאז `baseRev`, המטה רואה שלושה צדדים (בסיס, מרכז, ראשי נוכחי) ובוחר ערך לכל שדה.
7. **"סנכרן עם כולם"** מפיץ שינויים מאושרים גם למרכזים האחרים. מפיצים רק אחרי אישור המטה, כך שמרכז לא יכול לעקוף אותו.

### 5.3 היקף ראשון

התכנסות בלבד. כל מה שמורכב כאן (`Change`, `SyncBatch`, התראות, ממשק הכרעה) הוא גנרי לכל `entityType`, ולכן הרחבה לתקנים או לעובדים היא הוספת מפת שדות להשוואה.

---

## 6. תכונות נוספות: עקרונות מימוש

### 6.1 לוח שנה

- **ספקי פריטים** (`providers`): פונקציה לכל סוג (`tasks`, `reminders`, `releases`, `entries`, `occupancy`, `events`) שמחזירה פריטים לטווח תאריכים. המסך מפעיל את הספקים של השכבות המופעלות בלבד. אין שכפול נתונים.
- **תצוגות**: יום, שבוע, חודש, שנה וטווח מותאם הן אותו רכיב עם גודל תא שונה.
- **שכבות**: הבחירה נשמרת ב-`UserPref(key:'calendar.layers')`. הרשאות לכל שכבה נבדקות בצד ה-`DataStore`.
- **איוש לאורך זמן**: מהאיושים (`Assignment`) מחושבים הפערים (מהיום שאחרי השחרור ועד הכניסה של המחליף) והחפיפות. אין צורך בטבלה נוספת.
- **תזכורות**: אין תהליך רקע כשהדפדפן סגור, ולכן תזכורת שהגיע זמנה נוצרת **בעת התחברות** ובדיקה כל דקה בזמן שהמערכת פתוחה. שרת יחליף את זה בעבודה מתוזמנת.
- **משימות אוטומטיות**: `CalendarRule` רץ בעת שינוי תאריך שחרור או כניסה וביצירת רשומה. הוא יוצר או מעדכן משימה לפי `sourceKey`.

### 6.2 אירועים

`Event` + `EventStakeholder` + `Task.eventId` + `AuditLog.eventId`. סינון לוח השנה לפי אירוע מוצג רק למי שיש לו `event:<id>` או `calendar:layer:events`. יומן הפעולות נכתב אוטומטי ב-`DataStore`.

### 6.3 רשימת תפקידים ומבנה ארגוני

- **רשימת תפקידים**: טבלה של `Role` עם סינון לפי דרג, ענף, מדור ומרכז. תפקיד בלי `Assignment` פעיל מסומן "פנוי".
- **מבנה ארגוני**: אותו עץ, אבל מתוך `Role.parentRoleId`. מסננים: **בעלי תפקידים בלבד**, **היררכיה** (כולל/בלי כפיפים), **תפקידים בלי אנשים**, **אנשים ותפקידים שלא באיוש** (עובדים בלי `Assignment`, ותפקידים בלי עובד).
- הפרדה בין עץ עובדים (`managerId`, קיים) לעץ תפקידים: בשלב הראשון העץ הקיים נשאר, והתפקידים מופקים ממנו.

### 6.4 טופס חו"ל

`AbroadForm` + `FileBlob`. האחראי הוא `Responsibility(key:'abroad-forms')`. סימון "הוזן" או "החזר לתיקון" (יוצר `Task` רגילה עם `dueDate`, `source:'abroad:<id>'`) כותבים ל-`AuditLog`.

---

## 7. מיגרציה בלי לאבד כלום

עקרון: **הוספה בלבד, קריאה לאחור, גיבוי לפני**. המפתחות הישנים נשארים עד שהמשתמש מאשר מחיקה.

1. **גיבוי אוטומטי** לפני המיגרציה הראשונה: שכפול כל מפתחות `hub:*` ל-`hub-db` (IndexedDB) תחת `backup:<timestamp>`, וכפתור "הורדת גיבוי JSON" למשתמש. אם הגיבוי נכשל, המיגרציה לא מתחילה.
2. **גרסת סכמה**: `meta.schemaVersion` (חסר = 1). כל מיגרציה היא פונקציה אידמפוטנטית `vN -> vN+1`. אחרי כל אחת נשמרת הגרסה, כך שכשל באמצע ממשיך מהנקודה הנכונה.
3. **רשימת מיגרציות מומלצת**:
   - **M2** מטא-דאטה: `rev=1, updatedAt, updatedBy` לכל רשומה קיימת. לא משנה מבנה.
   - **M3** מרכז ברירת מחדל: יצירת מטה ו"מרכז ראשי", `centerId` לכל רשומה לפי `employee.department` (טקסט) ואם חסר לפי המרכז הראשי. הטקסט המקורי נשמר.
   - **M4** קבצים: העברת `file.dataUrl` מ-`infoItems`, תגובות משימה ובקשות נוכחות ל-`FileBlob`, ושמירת `fileId`. לא מוחקים את ה-DataURL עד אימות (גודל + `sha256`).
   - **M5** OrgUnit: יצירת רשומות ענף ומדור מהערכים הקיימים (איחוד לפי שם, עם דוח "שמות דומים" לאישור), וקישור `industryId`/`madorId`. השדות הטקסטואליים נשארים.
   - **M6** תפקידים ואיוש: `Role` לכל תקן, `Assignment` מ-`currentAppointment` (עם `to = releaseDate`) ומ-`futureAppointment` (עם `from = staffingDate`).
   - **M7** משימות: `source:'manual'` לכולן.
   - **M8** סריקת סתירות ראשונה במצב "דוח בלבד" (בלי התראות) כדי לא להציף.
4. **דוח מיגרציה** ("יבשה"): לפני הרצה בפועל מוצגת רשימת מה ישתנה ומספר הרשומות. אחרי הרצה מוצגת תוצאה והאפשרות "שחזר מגיבוי".
5. **מפתחות חדשים בלבד**: שום מיגרציה לא כותבת מעל ערך של מפתח קיים בלי גיבוי. שדות חדשים הם אופציונליים, וקוד שלא מכיר אותם מתעלם מהם.

---

## 8. סתירות: זיהוי, מניעה ואחראים

### 8.1 מניעה: איך הופכים כל נתון למקור אחד

| נתון | מצב היום | הצעה |
| --- | --- | --- |
| תקן של עובד | מקור יחיד (`linkedEmployeeId`); כפילות רק של שם ומספר אישי במינוי | להציג שם ומספר אישי **מהעובד** כשיש קישור, ולשמור את הטקסט רק למאייש בלי רשומת עובד |
| עובד על כמה תקנים | נאכף רק בטופס | לאכוף ב-`DataStore.put(position)` ובייבוא (כלל סתירה כרשת ביטחון) |
| תאריך שחרור | שלושה מקורות | מקור יחיד אחד לכל תקן-איוש: `Assignment.to` (נגזר מ-`currentAppointment.releaseDate`); `convergence.releaseDate` ו-`employee.compulsoryReleaseDate` נשארים שדות נפרדים בעלי משמעות נפרדת. **נדרשת החלטה שלך על המשמעות של "שחרור מחובה"** |
| מרכז, ענף, מדור | טקסט חופשי בהרבה מקומות, מועתק בזמן יצירה | הפניה ל-`OrgUnit` לפי `id`. ב-התכנסות ובתמריצים: **נגזר מהעובד** כשיש `employeeId` (עם שדה עוקף מפורש לחריגים) |
| מדור ב-התכנסות/תמריצים מול `employee.mador` | מועתק מ-`employee.team` | להפסיק להעתיק, לגזור מ-`employee.mador`, ולהעביר את הערכים הקיימים של `team` למקום הנכון בעזרת דוח אישור (אותו ערך עשוי להיות צוות ולא מדור) |
| מונה 0/1 מול מספר המאיישים | טקסט חופשי | **נגזר**: מספר `Assignment` פעילים על התקן. `counterStatus` נשאר כערך נקוב להשוואה בלבד |
| עובד לא פעיל על תקן | אפשרי | כלל סתירה, ובשמירת עובד "לא פעיל" שאלה "לשחרר מהתקן?" |

### 8.2 זיהוי: מנוע כללים גנרי

כלל הוא אובייקט בקוד: `{ id, title, entities, responsibleKey, detect(ctx) }`. `detect` מחזיר רשימת ממצאים (`entityRefs`, `details`). הממצאים נשמרים עם `fingerprint` יציב.

**מנוע**:
- **מתי רץ**: בכל `DataStore.put/patch` של ישות שהכלל מצהיר עליה (בדיקה מצומצמת), אחרי ייבוא מאקסל (בדיקה מלאה), ובכל התחברות של אחראי (בדיקה מלאה ברקע).
- **ממצא חדש** יוצר `Notification` לאחראי. ממצא שנעלם מעצמו עובר ל-`resolved`.
- **אפשרויות לאחראי**: *עדכן בכל המקומות* (בוחרים מקור אמת, והכלל מציע פעולת תיקון לכל צד), *תזכיר לי מאוחר יותר* (`snoozeUntil`), *הוסף למשימות לבדיקה* (יוצר `Task` עם `source:'conflict:<id>'`), *התעלם* (`status:'ignored'`, ה-`fingerprint` לא יוצר התראה חדשה).
- **הרחבה בלי קוד חדש לכל מקרה**: סוגי כללים הצהרתיים נוספים לצד כללי קוד:
  ```
  { type:'equals',  left:'employee.mador',        right:'convergence.mador',  join:'convergence.employeeId=employee.id' }
  { type:'maxCount', collection:'assignment',     group:'positionId', max:'position.counter' }
  { type:'forbid',  when:'employee.active=false', and:'assignment.active' }
  ```
  כך כלל חדש (למשל ממקור ייבוא) הוא שורה ברשימה.

### 8.3 כללים התחלתיים (לאישור סופי שלך)

| # | כלל | מה נבדק | ברירת מחדל לאחראי |
| --- | --- | --- | --- |
| 1 | תקן בכרטיס עובד מול ניהול תקנים | עובד מוצג על תקן אחד בכרטיס (נגזר) אך מופיע כמאייש בתקן אחר, או כתוב לו שם/מספר אישי שונים בתקן; כולל עובד המקושר ליותר מתקן אחד | אחראי תקנים |
| 2 | תאריך שחרור בכרטיס עובד מול התכנסות | `employee.compulsoryReleaseDate` (או שחרור המינוי) שונה מ-`convergence.releaseDate` של אותו עובד | אחראי התכנסות |
| 3 | יותר עובדים על תקן מהמונה | מספר מאיישים פעילים מעל המונה (`מונה 0/1`) | אחראי תקנים |
| 4 | עובד לא פעיל שמאייש תקן | `employee.active=false` ו-`linkedEmployeeId` שלו מחובר | אחראי תקנים |
| 5 | מרכז/ענף/מדור בכרטיס עובד מול התכנסות ותמריצים | ערכים שונים באותו `employeeId` | אחראי ארגוני (לאישור) |

**שאלות פתוחות לכלים אלה:**
1. כלל 2: מה ההבדל בין "שחרור מחובה" של העובד לבין "תאריך שחרור" במינוי התקן? האם הם אמורים להיות שווים?
2. כלל 3: מה המונה בפועל? `מונה 0` אומר "אין מאייש מותר", ו-`מונה 1` "מאייש אחד"? האם יש תקנים עם יותר מאחד?
3. כלל 5: מי האחראי הנכון, ואם הערך שונה בכוונה (עובד מושאל), איך מסמנים חריג?
4. האם שדה `team` ("צוות") בעובד הוא בעצם המדור שהועתק עד היום, ואם כן להעביר אותו אוטומטית ל-`mador`?

---

## 9. סדר בנייה מומלץ

כל שלב ניתן לבדיקה בנפרד, ואחריו commit. אין מעבר לשלב הבא לפני שהקודם עובד על הנתונים הקיימים.

| # | שלב | מה נבנה | איך בודקים (קבלה) |
| --- | --- | --- | --- |
| 0 | רשת ביטחון | ייצוא/ייבוא גיבוי JSON מלא, ודוח בריאות נתונים (ספירות לכל מפתח) | ייצוא → מחיקת storage → ייבוא מחזיר מצב זהה |
| 1 | `DataStore` כעטיפה | `storeGet/storeSet` עוברים דרך `DataStore` בלי שינוי התנהגות | כל 14 הלשוניות ופעולות CRUD עובדות כמו קודם; אותם נתונים נשמרים באותם מפתחות |
| 2 | מטא-דאטה וגרסאות | `rev/updatedAt/updatedBy`, `schemaVersion`, מסגרת מיגרציות עם גיבוי (M2) | נתונים ישנים נטענים; `rev` עולה בשמירה; כשל מדומה באמצע מיגרציה ממשיך תקין |
| 3 | יומן פעולות | `AuditLog` ב-IndexedDB, כתיבה אוטומטית מ-`DataStore`, מסך צפייה בסיסי | כל סוגי הפעולות נרשמים עם `before/after`; ייבוא נרשם כ-`source:'import'` |
| 4 | קבצים | `FileBlob` ב-IndexedDB ומיגרציה M4 | קובץ ישן נפתח ללא שינוי; אחרי המיגרציה אותו `sha256`; מכסת localStorage ירדה |
| 5 | התראות | `Notification` ותיבת התראות, והצגה בכל התחברות | התראה נשמרת, מוצגת בכניסה, ו"טופל" מעלים אותה |
| 6 | מרכזים והיקף | `Center`, `user.scope`, `centerId`, סינון ב-`DataStore.list` (M3) | משתמש מרכז X לא רואה רשומות של Y; מטה רואה הכול; משתמש-על ללא שינוי |
| 7 | OrgUnit | ענף/מדור כישויות (M5) ושימוש בהן בטפסים (בחירה מרשימה) | שמות קיימים נשמרים; דוח שמות דומים; סינונים עובדים |
| 8 | מנוע סתירות | `ConflictRule`, ממצאים, אחראים, פעולות (עדכן/דחה/משימה/התעלם) וכללים 1–5 | נתונים בדויים יוצרים ממצא אחד לכל כלל; "התעלם" לא חוזר; תיקון מעלים |
| 9 | תפקידים ואיוש | `Role`, `Assignment` (M6), רשימת תפקידים, מסנני מבנה ארגוני | איוש מהנתונים הקיימים תואם תקנים; פער וחפיפה מחושבים נכון |
| 10 | לוח שנה לקריאה | ספקים, תצוגות ושכבות ושמירת בחירה לכל משתמש | כל תצוגה מציגה אותם פריטים; שכבת אירועים מוסתרת ללא הרשאה |
| 11 | תזכורות ומשימות אוטומטיות | `Reminder`, `CalendarRule`, מפתח אי-כפילות | שינוי תאריך שחרור מעדכן משימה ולא יוצר שנייה; תזכורת מופיעה בכניסה |
| 12 | סנכרון התכנסות | `Change`, `SyncBatch`, ממשק diff והכרעה, התראות מטה | תרחיש מלא של מרכז ← מטה: אישור, דחייה, בבדיקה והתנגשות |
| 13 | אירועים | `Event`, בעלי עניין, משימות לאירוע, סינון | בעל עניין רואה רק את האירוע שלו; יומן מציג את כל הפעולות |
| 14 | טופס חו"ל | `AbroadForm` מעל קבצים ומשימות | מחזור: הגשה → החזרה לתיקון עם יעד → הגשה מחדש → "הוזן" |
| 15 | הרחבת סנכרון | תקנים ועובדים, ושאר מפות שדות | אותו תרחיש כמו שלב 12 על ישות נוספת |

**נימוק הסדר:** שלבים 0–5 הם תשתית שכל הפיצ'רים צריכים (גיבוי, גרסאות, יומן, קבצים, התראות). שלבים 6–7 מקבעים מרכזים ויחידות לפני שבונים עליהם. מנוע הסתירות (8) מקדים את הסנכרון (12) כי שניהם חולקים diff והתראות, והוא גם מנקה נתונים לפני שמתחילים לסנכרן אותם. תפקידים (9) מקדימים את לוח השנה (10) כי שכבת האיוש תלויה בהם.

---

## 10. החלטות שאני צריך ממך לפני שלב 1

1. מה ההבדל בין "שחרור מחובה" של עובד לתאריך שחרור במינוי תקן (שאלה 1 בסעיף 8.3)?
2. האם `team` בעובד הוא מדור שהועתק עד היום, ואם כן להעביר ל-`mador`?
3. האם "מטה" הוא מרכז אחד עם משתמשים משלו, או יכולים להיות כמה משתמשי מטה עם אחראיות שונות?
4. מי האחראי ברירת מחדל על כל כלל סתירה (סעיף 8.3)?
5. האם סנכרון "עם כולם" מפיץ גם שינויים של מרכזים אחרים, או רק של המרכז שביצע?
6. האם עובד יכול להשתייך ליותר ממרכז אחד (השאלה משפיעה על `centerId`)?
