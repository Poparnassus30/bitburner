/** @param {NS} ns */

const PORTS = [
    ["BruteSSH.exe", "brutessh"],
    ["FTPCrack.exe", "ftpcrack"],
    ["relaySMTP.exe", "relaysmtp"],
    ["HTTPWorm.exe", "httpworm"],
    ["SQLInject.exe", "sqlinject"]
];

export function acquireRoot(ns, host, config) {
    if (ns.hasRootAccess(host)) return true;

    // Ne rien modifier en simulation
    if (config.dryRun) return false;

    for (const [file, method] of PORTS) {
        if (!ns.fileExists(file, config.source)) {
            continue;
        }

        try {
            ns[method](host);
        } catch (error) {
            ns.print(
                `PORT ERROR ${host}: ${String(error)}`
            );
        }
    }

    const required =
        ns.getServerNumPortsRequired(host);

    const opened =
        ns.getServer(host).openPortCount;

    if (
        opened >= required &&
        ns.fileExists("NUKE.exe", config.source)
    ) {
        try {
            ns.nuke(host);
        } catch (error) {
            ns.print(
                `NUKE ERROR ${host}: ${String(error)}`
            );
        }
    }

    return ns.hasRootAccess(host);
}
