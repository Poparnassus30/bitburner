
/** @param {NS} ns */

export const VERSION = 2;

export async function main(ns) {
    // Annonce de la version exécutee
    ns.print(`MASTER_VERSION:${VERSION}`);

    // Cible transmise par MASTER
    const cible = String(
        ns.args[0] ?? "n00dles"
    );

    while (true) {
        const securite =
            ns.getServerSecurityLevel(cible);

        const securiteMin =
            ns.getServerMinSecurityLevel(cible);

        const argent =
            ns.getServerMoneyAvailable(cible);

        const argentMax =
            ns.getServerMaxMoney(cible);

        if (securite > securiteMin + 5) {
            await ns.weaken(cible);

        } else if (argent < argentMax * 0.75) {
            await ns.grow(cible);

        } else {
            await ns.hack(cible);
        }
    }
}
