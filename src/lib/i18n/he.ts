// The Hebrew dictionary, and the shape every other dictionary must match.
//
// Wording note: this avoids gendered second-person phrasing. Instead of
// "הוסף משימה" (masculine) it uses "הוספת משימה" (a neutral noun form) - both
// neutral and the accepted style for Hebrew interfaces.
//
// No `as const` on purpose: the Strings type is derived from this object, and
// literal types here would force the English dictionary to contain these
// exact strings. Without it, English is only required to match the shape.

import { days, pointsWord, tasksWord } from '../format'

export const he = {
  appName: 'HouseHero',

  nav: {
    today: 'היום',
    tasks: 'משימות',
    rewards: 'תגמולים',
    stats: 'סטטיסטיקות',
    more: 'עוד',
  },

  common: {
    cancel: 'ביטול',
    save: 'שמירה',
    saving: 'שומר...',
    working: 'רגע...',
    loading: 'טוען...',
    tryAgain: 'ניסיון נוסף',
    somethingWrong: 'משהו השתבש',
    undo: 'ביטול',
    close: 'סגירה',
    delete: 'מחיקה',
    edit: 'עריכה',
    everyone: 'כולם',
  },

  signIn: {
    tagline: 'ניהול משימות בית משותף. השלמת משימה מזכה בנקודות שאפשר לממש בתגמולים.',
    button: 'כניסה עם Google',
    opening: 'פותח את Google...',
    privacy:
      'חשבון Google משמש רק כדי לזהות אותך ולהציג את שמך למי שחולק איתך מרחב. שום דבר אחר לא נשמר ולא נשלח.',
  },

  onboarding: {
    title: 'עוד רגע מסיימים',
    lede: 'המשימות חיות בתוך מרחב בית משותף. אפשר ליצור אחד, או להצטרף למרחב שכבר קיים.',
  },

  points: {
    lifetime: 'נקודות שנצברו',
    spendable: 'זמינות למימוש',
    earned: (n: number) => `+${n} נקודות!`,
  },

  today: {
    titleActive: 'היום',
    titleDone: 'הכול בוצע',
    needsAction: (n: number) => `${tasksWord(n, 'he')} ${n === 1 ? 'ממתינה' : 'ממתינות'}`,
    allDone: 'כל המשימות שהיו להיום כבר בוצעו.',
    nothingDue: 'אין משימות להיום.',
    groupLate: 'באיחור',
    groupDue: 'להיום',
    groupSnoozed: 'מושהה',
    groupDone: 'בוצעו היום',
    someSnoozed: (n: number) => `${tasksWord(n, 'he')} מושהות`,
    emptyTitle: 'עוד אין משימות',
    emptyBody: 'מוסיפים את הראשונה, ו-HouseHero יתחיל להזכיר לכולם במרחב.',
    addTask: 'הוספת משימה',
  },

  task: {
    complete: 'בוצע',
    completeAria: (name: string) => `סימון ${name} כבוצעה`,
    badgeLate: (n: number) => `איחור של ${days(n, 'he')}`,
    badgeDue: 'היום',
    badgeDone: 'הושלמה',
    pointsBadge: (n: number) => `${n} נק'`,
    completedBy: (who: string) => `בוצעה על ידי ${who}`,
    completedByYou: 'בוצעה על ידך',
    nextIn: (when: string) => `הבאה ${when}`,
    dueOn: (date: string) => `יעד: ${date}`,
    nextOn: (date: string) => `הבאה: ${date}`,
    someoneElse: 'מישהו אחר',
    assignedTo: (who: string) => `שייכת ל${who}`,
    assignedToYou: 'שייכת אליך',
    undoCompletion: 'ביטול ביצוע',
    unwaterAria: (name: string) => `ביטול הביצוע של ${name}`,
    completionUndone: (name: string) => `בוטל הביצוע של ${name}.`,
    snooze: 'השהיה',
    snoozeAria: (name: string) => `השהיית התזכורת של ${name}`,
    cancelSnooze: 'ביטול השהיה',
    cancelSnoozeAria: (name: string) => `ביטול ההשהיה של ${name}`,
    snoozedUntil: (when: string) => `מושהה עד ${when}`,
    editAria: (name: string) => `עריכת ${name}`,
    completed: (name: string, points: number) => `${name} בוצעה. +${points} נקודות!`,
  },

  history: {
    title: (name: string) => `היסטוריית הביצוע של ${name}`,
    empty: 'עוד לא בוצעה אף פעם.',
    entry: (who: string, points: number) => `${who} · +${points} נק'`,
  },

  snooze: {
    title: (n: number): string => (n === 1 ? 'השהיית תזכורת' : 'השהיית תזכורות'),
    presets: {
      thirtyMinutes: 'חצי שעה',
      oneHour: 'שעה',
      threeHours: '3 שעות',
    },
    custom: 'זמן מותאם אישית',
    setCustom: 'קביעה',
    invalidCustom: 'הזמן צריך להיות בעתיד.',
    confirmed: (when: string) => `התזכורת תחזור ב-${when}.`,
    cancelled: 'ההשהיה בוטלה.',
  },

  taskForm: {
    titleNew: 'משימה חדשה',
    titleEdit: 'עריכת משימה',
    name: 'שם',
    namePlaceholder: 'לפנות את המדיח',
    description: 'תיאור (לא חובה)',
    descriptionPlaceholder: 'פרטים נוספים',
    type: 'סוג המשימה',
    typeOneTime: 'חד-פעמית',
    typeRecurring: 'חוזרת',
    recurrenceMode: 'תבנית החזרה',
    modeInterval: 'כל כמה ימים',
    modeWeekly: 'ימים קבועים בשבוע',
    intervalLabel: 'לחזור כל',
    intervalUnit: 'ימים',
    intervalAria: 'מספר הימים בין חזרה לחזרה',
    weeklyDaysLabel: 'באילו ימים',
    endCondition: 'מתי לסיים',
    endNever: 'אף פעם - חוזרת תמיד',
    endAfterCount: 'אחרי מספר פעמים',
    endOnDate: 'בתאריך מסוים',
    endAfterCountLabel: 'מספר פעמים',
    endDateLabel: 'תאריך סיום',
    points: 'ניקוד',
    pointsUnit: "נק'",
    pointsAria: 'כמה נקודות המשימה שווה',
    reminderTime: 'שעת התזכורת',
    reminderAria: 'שעת התזכורת של המשימה',
    dueDate: 'תאריך יעד',
    firstDueDate: 'תאריך היעד הראשון',
    assignedTo: 'שייכת ל',
    add: 'הוספת משימה',
    delete: 'מחיקת המשימה',
    confirmDelete: (name: string) => `למחוק את "${name}"? המשימה תימחק אצל כל מי שנמצא במרחב.`,
    errorNoName: 'צריך לתת למשימה שם.',
    errorPoints: 'הניקוד צריך להיות בין 1 ל-1000.',
    errorInterval: 'התדירות צריכה להיות בין יום אחד ל-365 ימים.',
    errorWeeklyDays: 'צריך לבחור לפחות יום אחד בשבוע.',
    errorEndAfterCount: 'מספר הפעמים צריך להיות לפחות 1.',
    errorEndDate: 'תאריך הסיום צריך להיות אחרי תאריך היעד.',
  },

  tasks: {
    empty: 'אין עדיין משימות במרחב הזה.',
    emptyBody: 'מוסיפים משימה, קובעים לה ניקוד ושעת תזכורת.',
    addFirst: 'הוספת המשימה הראשונה',
    count: (n: number) => tasksWord(n, 'he'),
    addAria: 'הוספת משימה',
    added: (name: string) => `${name} נוספה.`,
    deleted: 'המשימה נמחקה.',
  },

  rewards: {
    title: 'תגמולים',
    empty: 'אין עדיין תגמולים במרחב הזה.',
    emptyBody: 'מוסיפים תגמול וקובעים לו מחיר בנקודות.',
    addFirst: 'הוספת התגמול הראשון',
    addAria: 'הוספת תגמול',
    cost: (n: number) => pointsWord(n, 'he'),
    redeem: 'מימוש',
    redeemAria: (title: string) => `בקשת מימוש של ${title}`,
    requested: (title: string) => `הבקשה למימוש "${title}" נשלחה לאישור.`,
    notEnoughPoints: 'אין מספיק נקודות זמינות למימוש הזה.',
    pendingTitle: 'ממתין לאישור',
    pendingMine: (title: string) => `הבקשה שלך: ${title}`,
    pendingTheirs: (who: string, title: string) => `${who} מבקש/ת: ${title}`,
    approve: 'אישור',
    approveAria: (title: string) => `אישור המימוש של ${title}`,
    reject: 'דחייה',
    rejectAria: (title: string) => `דחיית המימוש של ${title}`,
    cancel: 'ביטול הבקשה',
    cancelAria: (title: string) => `ביטול בקשת המימוש של ${title}`,
    approved: (title: string) => `אושר המימוש של ${title}.`,
    rejected: (title: string) => `נדחה המימוש של ${title}.`,
    cancelled: (title: string) => `בקשת המימוש של ${title} בוטלה.`,
    cannotDecideOwn: 'רק מישהו אחר במרחב יכול לאשר או לדחות את הבקשה שלך.',
    titleNew: 'תגמול חדש',
    titleEdit: 'עריכת תגמול',
    name: 'שם',
    namePlaceholder: 'ערב סרט לבחירתי',
    costLabel: 'מחיר בנקודות',
    add: 'הוספת תגמול',
    delete: 'מחיקת התגמול',
    confirmDelete: (title: string) => `למחוק את "${title}"?`,
    errorNoName: 'צריך לתת לתגמול שם.',
    errorCost: 'המחיר צריך להיות לפחות נקודה אחת.',
    added: (title: string) => `${title} נוסף.`,
    deleted: 'התגמול נמחק.',
  },

  stats: {
    title: 'סטטיסטיקות',
    lifetimeTitle: 'נקודות שנצברו',
    spendableTitle: 'זמינות למימוש',
    byPerson: 'לפי מי שביצע',
    completionsCount: (n: number) => `${tasksWord(n, 'he')} הושלמו`,
    topTask: 'המשימה שהושלמה הכי הרבה',
    noData: 'עוד אין מספיק נתונים להצגה.',
    last7Days: '7 הימים האחרונים',
    allTime: 'מאז ומתמיד',
  },

  space: {
    title: 'מרחב',
    subtitle: 'כל מי שנמצא כאן חולק את אותה רשימת משימות.',
    rename: 'שינוי שם',
    nameAria: 'שם המרחב',
    inviteTitle: 'הזמנת אנשים',
    inviteBody: 'הם פותחים את הקישור, נכנסים עם Google, ומקלידים את הקוד הזה.',
    inviteCodeAria: 'קוד הזמנה',
    share: 'שליחת הזמנה',
    copied: 'ההזמנה הועתקה.',
    codeIs: (code: string) => `קוד ההזמנה: ${code}`,
    shareMessage: (name: string, url: string, code: string) =>
      `הצטרפו למרחב "${name}" ב-HouseHero.\n\nנכנסים ל-${url} ומקלידים את הקוד: ${code}`,
    shareTitle: 'הזמנה ל-HouseHero',
    members: (n: number) => `חברים (${n})`,
    memberFallback: 'חבר',
    you: 'אני',
    owner: 'מנהל',
    yourSpaces: 'המרחבים שלך',
    createOrJoin: 'יצירה או הצטרפות למרחב נוסף',
    leave: 'יציאה מהמרחב',
    confirmLeave: (name: string) => `לצאת מ"${name}"? המשימות נשארות אצל שאר החברים.`,
    left: 'יצאת מהמרחב.',
    remove: 'מחיקת המרחב לכולם',
    confirmRemove: (name: string) =>
      `למחוק את "${name}" לכולם? כל המשימות וההיסטוריה שבו יימחקו.`,
    removed: 'המרחב נמחק.',
    switchAria: 'המרחב הנוכחי',
  },

  spaceSetup: {
    titleCreate: 'מרחב חדש',
    titleJoin: 'הצטרפות למרחב',
    tabCreate: 'יצירה',
    tabJoin: 'הצטרפות',
    nameIt: 'איך לקרוא לו',
    namePlaceholder: 'הבית',
    nameHint: 'אחרי היצירה תקבל קוד להזמנת האחרים.',
    codeLabel: 'קוד הזמנה',
    codePlaceholder: 'ABC123',
    codeHint: 'מבקשים את הקוד בן שש התווים ממי שיצר את המרחב.',
    create: 'יצירת מרחב',
    join: 'הצטרפות',
    created: (name: string) => `"${name}" נוצר.`,
    joined: (name: string) => `הצטרפת ל"${name}".`,
    defaultName: 'הבית',
  },

  settings: {
    title: 'הגדרות',
    notifications: 'התראות במכשיר הזה',
    turnOn: 'הפעלת תזכורות',
    turnOff: 'כיבוי במכשיר הזה',
    sendTest: 'שליחת התראת בדיקה',
    enabled: 'התזכורות הופעלו במכשיר הזה.',
    disabled: 'התזכורות כובו במכשיר הזה.',
    blockedToast: 'הדפדפן חוסם התראות לאתר הזה. צריך לאשר אותן בהגדרות האתר ולחזור לכאן.',
    installHint:
      'ההתראות אמינות יותר כשהאפליקציה מותקנת: תפריט הדפדפן ← "הוספה למסך הבית".',
    timezone: (tz: string) => `אזור הזמן שלך: ${tz}`,
    account: 'חשבון',
    signOut: 'התנתקות',
    pushState: {
      subscribed: 'פעיל. המכשיר הזה יקבל התראות על משימות.',
      prompt: 'כבוי. אפשר להפעיל כדי לקבל כאן התראות על משימות.',
      denied:
        'חסום. הדפדפן מסרב לשלוח התראות לאתר הזה - צריך לאשר אותן בהגדרות האתר ואז לחזור.',
      unsupported: 'הדפדפן הזה לא תומך בהתראות. באנדרואיד כדאי Chrome, Edge או Firefox.',
      unconfigured: 'האפליקציה נבנתה בלי מפתח התראות, ולכן אי אפשר לשלוח אותן. ראה SETUP.md.',
    },
    language: 'שפה',
    languageBody: 'משנה את הממשק ואת נוסח ההתראות שנשלחות אליך. רק בשבילך — לכל אחד יש בחירה משלו.',
    test: {
      noServer: 'לא הצלחתי להגיע לשרת. האם הפונקציה send-test הועלתה?',
      notSignedIn: 'החיבור שלך פג. כדאי להתנתק ולהתחבר מחדש, ואז לנסות שוב.',
      notConfigured: 'ההגדרות בשרת חסרות. יש להריץ את סקריפט ההתקנה מול מסד הנתונים.',
      serverError: 'השרת החזיר שגיאה. אפשר לנסות שוב בעוד רגע.',
      noSubscription: 'המכשיר הזה עדיין לא רשום. צריך קודם להפעיל תזכורות.',
      rejected: 'שירות ההתראות דחה את הבקשה. כדאי לבדוק שהמפתחות תואמים.',
      sent: (delivered: number, total: number) =>
        `נשלחה ל-${delivered} מתוך ${total} ${total === 1 ? 'מכשיר' : 'מכשירים'}.`,
    },
  },

  errors: {
    noSuchCode: 'אין מרחב עם הקוד הזה. כדאי לבדוק את האותיות ולנסות שוב.',
    lastOwner:
      'המרחב הזה מנוהל רק על ידך ויש בו עוד חברים. אפשר למחוק אותו לכולם, אבל לא לצאת ולהשאיר אותו בלי מנהל.',
    notYourCompletion: 'רק מי שביצע את המשימה יכול לבטל את זה.',
  },

  setup: {
    title: 'צריך להשלים הגדרה',
    lede: 'לבנייה הזאת אין עדיין כתובת Supabase ומפתח, ולכן אי אפשר להתחבר.',
    body: 'צריך למלא את שני הערכים בקובץ src/config.ts. כל השלבים מפורטים ב-SETUP.md.',
  },
}

/**
 * The shape every language has to provide. Derived from the Hebrew dictionary
 * rather than written out by hand, so adding a string to one language makes
 * the other fail to compile until it is translated.
 */
export type Strings = typeof he
