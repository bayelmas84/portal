"use strict";
// Bu tablo, tasarım prototipindeki ACC matrisinin sunucu tarafı karşılığıdır.
// "write" -> oluşturma/değiştirme/onaylama dahil tam erişim, "read" -> yalnızca görüntüleme.
// Burada olmayan bir (rol, ekran) çifti erişimsiz sayılır (varsayılan ret).

const R = "read";
const W = "write";

const ACCESS = {
  admin: {
    announcements: R,
    training: R,
    "d.team": R, "d.docs": R, "d.docview": R, "d.appr": R, "d.cr": R,
    "d.meeting": R, "d.meetingview": R, "d.gantt": R,
    "m.users": W, "m.dir": W, "m.smtp": W, "m.brand": W, "m.avail": W,
  },
  pmdir: {
    announcements: R, training: R,
    "d.team": W, "d.docs": W, "d.docview": W, "d.appr": W, "d.cr": W,
    "d.meeting": W, "d.meetingview": W, "d.gantt": W,
    "m.users": R, "m.dir": R, "m.smtp": R, "m.brand": R, "m.avail": R,
  },
  inspection: {
    announcements: W, training: R,
    "d.docs": R, "d.docview": R, "d.appr": R,
    "d.meeting": R, "d.meetingview": R,
  },
  infosec: {
    announcements: W, training: R,
    "d.docs": R, "d.docview": R,
    "d.meeting": R, "d.meetingview": R,
  },
  control: {
    announcements: W, training: R,
    "d.docs": R, "d.docview": R, "d.appr": R,
    "d.meeting": R, "d.meetingview": R,
  },
  gmy: {
    announcements: R, training: R,
    "d.meeting": R, "d.meetingview": R, "d.gantt": R,
  },
  opsdir: {
    announcements: R, training: R,
    "d.meeting": R, "d.meetingview": R, "d.gantt": R,
  },
  pm: {
    announcements: R, training: R,
    "d.team": W, "d.docs": W, "d.docview": W, "d.appr": R, "d.cr": W,
    "d.meeting": W, "d.meetingview": W, "d.gantt": W,
  },
  dev: {
    announcements: R, training: R,
    "d.docs": R, "d.docview": R, "d.cr": R,
    "d.meeting": R, "d.meetingview": R, "d.gantt": R,
  },
  staff: {
    announcements: R, training: W,
    "d.docs": R, "d.docview": R,
    "d.meeting": R, "d.meetingview": R, "d.gantt": R,
  },
};

function levelOf(role, screenKey) {
  return (ACCESS[role] || {})[screenKey] || "none";
}

function canRead(role, screenKey) {
  return levelOf(role, screenKey) !== "none";
}

function canWrite(role, screenKey) {
  return levelOf(role, screenKey) === "write";
}

// Toplantı notlarında "her zaman görür" rolleri (katılımcı olsun olmasın) —
// prototipteki MEETING_ALWAYS ile birebir.
const MEETING_ALWAYS_ROLES = ["inspection", "infosec", "control"];

module.exports = { ACCESS, levelOf, canRead, canWrite, MEETING_ALWAYS_ROLES, R, W };
