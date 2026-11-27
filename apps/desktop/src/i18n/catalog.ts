import zh from "./translations/zh.json" with { type: "json" };

const en = {
  "stardust.startup.lock.title": "Stardust could not start",
  "stardust.startup.lock.message":
    "Stardust could not lock its data folder or reach an existing Stardust window. Close any Stardust processes, check that you can write to the data folder, and try again.",
};

export function startupLockCopy(languages: readonly string[]) {
  const catalog = /^zh(?:[-_]|$)/i.test(languages[0] ?? "") ? zh : en;
  return {
    title: catalog["stardust.startup.lock.title"],
    message: catalog["stardust.startup.lock.message"],
  };
}
