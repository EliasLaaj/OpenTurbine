Import("env")

dynconfig_by_env = {
    "esp32dev": "xtensa_esp32.so",
    "esp32s3dev": "xtensa_esp32s3.so",
}

dynconfig = dynconfig_by_env.get(env["PIOENV"])

if dynconfig:
    import os
    import shutil

    toolchain_dir = env.PioPlatform().get_package_dir("toolchain-xtensa-esp-elf")
    src = os.path.join(toolchain_dir or "", "lib", dynconfig)
    dst = os.path.join(env.subst("$PROJECT_DIR"), dynconfig)
    if os.path.exists(src):
        if (not os.path.exists(dst) or
                os.path.getmtime(src) > os.path.getmtime(dst) or
                os.path.getsize(src) != os.path.getsize(dst)):
            shutil.copy2(src, dst)

    env.Append(
        CCFLAGS=[f"-mdynconfig={dynconfig}"],
        CXXFLAGS=[f"-mdynconfig={dynconfig}"],
        ASFLAGS=[f"--dynconfig={dynconfig}"],
        LINKFLAGS=[
            f"-mdynconfig={dynconfig}",
            "-Wl,-EL",
        ],
    )


def patch_async_webserver_request(env):
    """Let the HTTP peer close completed ``Connection: close`` responses.

    ESPAsyncWebServer 3.11.2 always actively closes after the peer has ACKed
    the complete response. The prebuilt ESP32 lwIP has only 16 active PCBs and
    a 60 s MSL, so a sequence of cold browser connections can make port 80
    unreachable even though the ECU and Wi-Fi remain healthy. A TCP abort avoids
    TIME_WAIT but can race a browser's receive path and appear as a connection
    reset. Leaving the fully-ACKed socket open lets the conforming HTTP peer
    perform the advertised close; the existing RX timeout cleans up a stalled
    peer.
    """
    import os

    request_cpp = os.path.join(
        env.subst("$PROJECT_LIBDEPS_DIR"), env["PIOENV"],
        "ESPAsyncWebServer", "src", "WebRequest.cpp")
    if not os.path.exists(request_cpp):
        return
    with open(request_cpp, "r", encoding="utf-8") as handle:
        text = handle.read()
    old = "_client->close();  // this will trigger _onDisconnect() and object destruction"
    aborted = "_client->abort();  // response is fully ACKed; avoid ECU-side TIME_WAIT PCB exhaustion"
    new = "/* Peer closes the advertised Connection: close response; RX timeout guards stalled peers. */"
    count = text.count(old)
    aborted_count = text.count(aborted)
    patched_count = text.count(new)
    if count == 0 and aborted_count == 0 and patched_count == 2:
        return
    if count == 2 and aborted_count == 0 and patched_count == 0:
        patched = text.replace(old, new)
    elif count == 0 and aborted_count == 2 and patched_count == 0:
        patched = text.replace(aborted, new)
    else:
        raise RuntimeError(
            f"ESPAsyncWebServer completion patch expected 2 close sites, found "
            f"{count} original, {aborted_count} abort, and {patched_count} patched; "
            "review the pinned dependency before building")
    if patched != text:
        with open(request_cpp, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(patched)


patch_async_webserver_request(env)
