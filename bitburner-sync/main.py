"""NEXUS Sync : import initial, status, push manuel vers Bitburner 3.x.

Bitburner se connecte a ce serveur WebSocket local. Jamais de suppression
automatique, ni de redemarrage de scripts. Etat prive dans .sync-state.json.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import difflib
from pathlib import Path, PurePosixPath

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

HOST = "127.0.0.1"
PORT = 12525
GAME_HOST = "home"
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "nexus"
STATE = ROOT / "bitburner-sync" / ".sync-state.json"
EXTENSIONS = {".js", ".ts", ".jsx", ".tsx"}


def permitted(name: str) -> bool:
    """Accepter uniquement le code NEXUS; pas de donnees runtime."""
    p = PurePosixPath(name)
    return (
        name.startswith("nexus/")
        and not p.is_absolute()
        and ".." not in p.parts
        and "\\" not in name
        and p.suffix.lower() in EXTENSIONS
        and "data" not in p.parts
    )


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_state() -> dict[str, str] | None:
    if not STATE.exists():
        return None
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
    except UnicodeDecodeError as exc:
        raise ValueError("Etat JSON illisible (encodage UTF-8 requis)") from exc
    except json.JSONDecodeError as exc:
        raise ValueError("Etat JSON invalide (verifier le BOM UTF-8 et la syntaxe)") from exc
    if not isinstance(data, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in data.items()
    ):
        raise ValueError("Etat de synchronisation invalide")
    return data


def save_state(state: dict[str, str]) -> None:
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(STATE)


def local_files() -> dict[str, str]:
    if not SOURCE.exists():
        return {}
    result = {}
    for file in SOURCE.rglob("*"):
        if file.is_symlink():
            raise ValueError(f"Lien symbolique interdit: {file}")
        if not file.is_file():
            continue
        relative = file.relative_to(ROOT).as_posix()
        if permitted(relative):
            result[relative] = file.read_text(encoding="utf-8")
    return result


class Api:
    def __init__(self, ws):
        self.ws = ws
        self.sequence = 0

    async def call(self, method: str, params: dict | None = None):
        self.sequence += 1
        current = self.sequence
        await self.ws.send(json.dumps({
            "jsonrpc": "2.0", "id": current,
            "method": method, "params": params or {},
        }))
        while True:
            data = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=30))
            if not isinstance(data, dict) or data.get("id") != current:
                continue
            if data.get("error") is not None:
                raise RuntimeError(f"{method}: {data['error']}")
            return data.get("result")

    async def names(self) -> set[str]:
        names = await self.call("getFileNames", {"server": GAME_HOST})
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise ValueError("Reponse getFileNames inattendue")
        return set(names)

    async def read(self, name: str) -> str:
        value = await self.call("getFile", {"server": GAME_HOST, "filename": name})
        if not isinstance(value, str):
            raise ValueError(f"Reponse getFile inattendue: {name}")
        return value


async def do_import(api: Api) -> None:
    if STATE.exists():
        print("REFUS: import initial deja effectue. Utiliser status ou push.")
        return
    names = sorted(n for n in await api.names() if permitted(n))
    if not names:
        print("Aucun script NEXUS trouve sur home.")
        return
    conflicts = [n for n in names if (ROOT / Path(n)).exists()]
    if conflicts:
        print("REFUS: fichiers locaux deja presents (aucun ecrasement) :")
        for name in conflicts:
            print("  ", name)
        return

    contents = {n: await api.read(n) for n in names}
    print(f"{len(contents)} scripts a importer depuis home:")
    for name in contents:
        print("  ", name)
    answer = await asyncio.to_thread(input, "Confirmer l'import initial ? [oui/N] : ")
    if answer.strip().lower() != "oui":
        print("Import annule.")
        return

    for name, value in contents.items():
        dest = ROOT / Path(name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Mode x : creation exclusive, refuse d'ecraser un fichier arrive entretemps.
        with dest.open("x", encoding="utf-8", newline="") as out:
            out.write(value)
    save_state({name: digest(value) for name, value in contents.items()})
    print(f"IMPORT OK: {len(contents)} scripts. Aucun fichier distant modifie.")
    print("Verifier les secrets avant git add/commit/push, car le depot GitHub est public.")


async def inspect(api: Api, *, deploy: bool, show_diff: bool = False) -> None:
    state = load_state()
    if state is None:
        print("REFUS: executer 'import' avant status/push.")
        return
    local = local_files()
    remote_names = await api.names()
    to_push: list[tuple[str, str]] = []
    problems = []
    unchanged = 0

    for name, value in sorted(local.items()):
        local_hash = digest(value)
        old = state.get(name)
        if name not in remote_names:
            if old is not None:
                problems.append((name, "supprime du jeu depuis la derniere synchro"))
            else:
                to_push.append((name, value))
            continue

        remote_content = await api.read(name)
        remote_hash = digest(remote_content)

        if name == "nexus/dashboard.js":
            import difflib

            print("\n=== DIAGNOSTIC DASHBOARD ===")
            print("SOURCE :", local_hash)
            print("HOTE   :", remote_hash)
            print("BASE   :", old)
            print("SOURCE == BASE :", local_hash == old)
            print("HOTE == BASE   :", remote_hash == old)
            def line_info(content):
                return {
                    "caracteres": len(content),
                    "CRLF": content.count("\r\n"),
                    "LF": content.count("\n"),
                    "CR": content.count("\r"),
                    "fin_ligne": content.endswith("\n"),
                }

            print("FORMAT SOURCE :", line_info(value))
            print("FORMAT HOTE   :", line_info(remote_content))

            print("\nDIFFERENCES :")
            for line in difflib.unified_diff(
                remote_content.splitlines(keepends=True),
                value.splitlines(keepends=True),
                fromfile="BITBURNER",
                tofile="VS_CODE"
            ):
                print(line, end="")

            print("\n=== FIN DIAGNOSTIC ===\n")
        if show_diff and remote_hash != local_hash:
            print(f"\n=== DIFF {name}: BITBURNER -> VS_CODE ===")
            for line in difflib.unified_diff(
                remote_content.splitlines(keepends=True),
                value.splitlines(keepends=True),
                fromfile=f"BITBURNER/{name}",
                tofile=f"VS_CODE/{name}",
            ):
                print(line, end="" if line.endswith("\n") else "\n")
            print(f"=== FIN DIFF {name} ===\n")
        if remote_hash == local_hash:
            unchanged += 1
            # Aligner la base uniquement si les fichiers sont identiques.
            state[name] = local_hash
        elif old is None:
            problems.append((name, "existe deja dans le jeu, sans base commune"))
        elif remote_hash != old:
            problems.append((name, "le jeu a ete modifie depuis le dernier transfert"))
        else:
            to_push.append((name, value))

    for name in sorted(set(state) - set(local)):
        problems.append((name, "source locale manquante; aucune suppression"))

    print(f"IDENTIQUES: {unchanged} | A ENVOYER: {len(to_push)} | ALERTES: {len(problems)}")
    for name, reason in problems:
        print(f"  CONFLIT {name}: {reason}")
    for name, _ in to_push:
        print(f"  PUSH POSSIBLE {name}")

    if not deploy:
        print("Lecture seule : aucun fichier envoye.")
        return
    if problems:
        print("REFUS GLOBAL: conflits detectes. Aucun fichier envoye.")
        return
    if not to_push:
        save_state(state)
        print("Rien a envoyer.")
        return
    answer = await asyncio.to_thread(input, "Envoyer ces scripts vers home ? [oui/N] : ")
    if answer.strip().lower() != "oui":
        print("Push annule.")
        return

    for name, value in to_push:
        # Recontrole juste avant l'ecriture pour reduire les risques de conflit.
        names_now = await api.names()
        old = state.get(name)
        if name in names_now:
            if old is None or digest(await api.read(name)) != old:
                print(f"ARRET: {name} a change dans le jeu.")
                break
        elif old is not None:
            print(f"ARRET: {name} a disparu du jeu.")
            break

        response = await api.call("pushFile", {
            "server": GAME_HOST, "filename": name, "content": value,
        })
        if response != "OK":
            print(f"ARRET: reponse pushFile inattendue pour {name}: {response!r}")
            break
        if await api.read(name) != value:
            print(f"ARRET: verification distante echouee pour {name}")
            break
        state[name] = digest(value)
        save_state(state)
        print(f"ENVOYE ET VERIFIE : {name}")
    print("Les processus en execution ne sont pas redemarres automatiquement.")


async def main(command: str) -> None:
    print(f"NEXUS Sync [{command}] - ws://{HOST}:{PORT}")
    print("Bitburner > Options > Remote API : localhost / 12525 / WSS off / Connect")
    completed = asyncio.Event()

    async def handler(ws):
        if completed.is_set():
            await ws.close()
            return
        print("Bitburner connecte.")
        try:
            api = Api(ws)
            if command == "import":
                await do_import(api)
            else:
                await inspect(api, deploy=(command == "push"), show_diff=(command == "diff"))
        except (ConnectionClosed, asyncio.TimeoutError) as exc:
            print("Connexion interrompue :", exc)
        except Exception as exc:
            print("ERREUR :", exc)
        finally:
            completed.set()
            # Ne pas fermer immédiatement: évite les reconnexions en boucle.
            try:
                await asyncio.wait_for(ws.wait_closed(), timeout=1)
            except asyncio.TimeoutError:
                pass

    async with serve(handler, HOST, PORT, max_size=16 * 1024 * 1024):
        await completed.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NEXUS Sync - transfert manuel protege")
    parser.add_argument("command", choices=("import", "status", "diff", "push"))
    args = parser.parse_args()
    try:
        asyncio.run(main(args.command))
    except KeyboardInterrupt:
        print("Arret manuel.")
