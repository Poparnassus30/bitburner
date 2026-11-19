"""Bitburner 3.x Remote API : test local manuel, sans synchronisation automatique.

Bitburner se connecte à ce serveur WebSocket. Ce test ne lit aucun fichier
personnel et ne touche pas aux scripts NEXUS existants.
"""
from __future__ import annotations

import asyncio
import json

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

HOST = "127.0.0.1"
PORT = 12525
GAME_HOST = "home"
TEST_FILE = "nexus/sync-connection-test.js"
TEST_CONTENT = (
    "/** Fichier de test NEXUS Sync. */\n"
    "export async function main(ns) {\n"
    '    ns.tprint("Connexion NEXUS Sync OK");\n'
    "}\n"
)


async def rpc(ws, request_id: int, method: str, params: dict):
    await ws.send(json.dumps({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params,
    }))
    while True:
        message = await asyncio.wait_for(ws.recv(), timeout=15)
        response = json.loads(message)
        if not isinstance(response, dict) or response.get("id") != request_id:
            print("Notification ou réponse inattendue ignorée.")
            continue
        if response.get("error") is not None:
            raise RuntimeError(f"{method}: {response['error']}")
        return response.get("result")


async def handle_connection(ws):
    print("Bitburner connecté :", ws.remote_address)
    try:
        names = await rpc(ws, 1, "getFileNames", {"server": GAME_HOST})
        if not isinstance(names, list):
            print("Réponse inhabituelle :", repr(names))
            return
        print(f"Lecture OK : {len(names)} fichiers trouvés sur {GAME_HOST}.")
        print("Exemples :", ", ".join(map(str, names[:8])) or "(aucun)")

        print("Test de lecture terminé. Aucune modification effectuée.")
        if TEST_FILE in names:
            print(f"ATTENTION : {TEST_FILE} existe déjà, aucun écrasement autorisé.")
            return

        answer = await asyncio.to_thread(
            input, f"Créer seulement {TEST_FILE} dans Bitburner ? [o/N] : "
        )
        if answer.strip().lower() not in {"o", "oui"}:
            print("Écriture annulée.")
            return

        result = await rpc(ws, 2, "pushFile", {
            "filename": TEST_FILE,
            "content": TEST_CONTENT,
            "server": GAME_HOST,
        })
        print("pushFile :", repr(result))
        read_back = await rpc(ws, 3, "getFile", {
            "filename": TEST_FILE,
            "server": GAME_HOST,
        })
        print("Vérification :", "OK" if read_back == TEST_CONTENT else "CONTENU DIFFÉRENT")
    except (asyncio.TimeoutError, ConnectionClosed) as exc:
        print("Connexion interrompue :", exc)
    except Exception as exc:
        print("Erreur :", exc)


async def main():
    print(f"NEXUS Sync : ws://{HOST}:{PORT}")
    print("Bitburner > Options > Remote API : localhost / 12525 / WSS off / Connect")
    print("Arrêt : Ctrl+C")
    try:
        async with serve(handle_connection, HOST, PORT, max_size=8 * 1024 * 1024):
            await asyncio.Future()
    except OSError as exc:
        print("Impossible de démarrer le serveur :", exc)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Serveur arrêté.")
