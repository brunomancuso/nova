#!/usr/bin/env python3
"""
nova_emulator.py -- BLE GATT emulator for Nova table tennis robot
Uses winrt (Microsoft official Python WinRT bindings) directly.

Requirements:
    pip install winrt-runtime winrt-Windows.Devices.Bluetooth
                winrt-Windows.Devices.Bluetooth.GenericAttributeProfile
                winrt-Windows.Storage.Streams winrt-Windows.Foundation
"""

import asyncio
import hashlib
import struct
import logging
import uuid as _uuid

import winrt.windows.devices.bluetooth as bt
import winrt.windows.devices.bluetooth.genericattributeprofile as gatt
import winrt.windows.storage.streams as streams

SERVICE_UUID = "02f00000-0000-0000-0000-00000000fe00"
UUID_N       = "02f00000-0000-0000-0000-00000000ff02"
UUID_W       = "02f00000-0000-0000-0000-00000000ff01"

SALT     = "Mjgx1jAwXDBaMFcxCz3JBgNVBAYT4kJF7Rkw"
MSG_DONE = bytes.fromhex("00020300050100")
SERIAL   = "NOVA12345678"
CODE     = "EMU0"

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

hs_state    = "idle"
notify_char = None


def compute_expected_hash():
    hashme = SERIAL
    for c in SERIAL:
        hashme += SALT[ord(c) % 0x24]
    hashme += CODE
    return hashlib.md5(hashme.encode()).hexdigest()


def build_handshake_payload():
    return b"\x00" * 6 + (SERIAL + CODE).encode()


def decode_ball(data):
    upper, lower     = struct.unpack_from("<II",  data, 0)
    height, drop, fr = struct.unpack_from("<fff", data, 8)
    reps,            = struct.unpack_from("<I",   data, 20)
    return dict(
        upper_rpm=upper, lower_rpm=lower,
        height=round(height * 3 - 50, 1),
        drop=round((drop + 22) / 44 * 20 - 10, 1),
        bpm=round((fr - 0.5) * 100, 1),
        reps=reps,
    )


def bytes_to_ibuffer(data):
    writer = streams.DataWriter()
    writer.write_bytes(list(data))
    return writer.detach_buffer()


async def send_notify(data):
    if notify_char is None:
        return
    buf = bytes_to_ibuffer(data)
    for client in notify_char.subscribed_clients:
        await notify_char.notify_value_async(buf, client)


async def handle_write(args):
    global hs_state
    req    = args.get_request()
    reader = streams.DataReader.from_buffer(req.value)
    data   = bytes([reader.read_byte() for _ in range(reader.unconsumed_buffer_length)])
    req.respond_with_value(req.value)
    log.info(f"<- RX [{hs_state:10s}]: {data.hex()}")

    if hs_state == "handshake" and data[:4] == bytes([0x07, 0x00, 0x00, 0x00]):
        log.info("  [1/4] Sending serial+code")
        await send_notify(build_handshake_payload())
        hs_state = "auth_1"

    elif hs_state == "auth_1" and len(data) > 3 and data[0] == 0x08:
        recv = data[3:].decode(errors="ignore").strip("\x00")
        ok   = recv == compute_expected_hash()
        log.info(f"  [2/4] MD5 {'OK' if ok else 'MISMATCH'}")
        await send_notify(bytes([0x00]))
        hs_state = "auth_2"

    elif hs_state == "auth_2" and data[:3] == bytes([0x01, 0x00, 0x00]):
        log.info("  [3/4] Step 2 ack")
        await send_notify(bytes([0x00]))
        hs_state = "auth_3"

    elif hs_state == "auth_3" and data[:3] == bytes([0x02, 0x00, 0x00]):
        log.info("  [4/4] Step 3 ack")
        await send_notify(bytes([0x00]))
        hs_state = "auth_4"

    elif hs_state == "auth_4" and len(data) >= 2 and data[0] == 0x80 and data[1] == 0x01:
        await send_notify(bytes([0x00]))
        hs_state = "ready"
        log.info("  HANDSHAKE COMPLETE -- ready to receive drill packets")

    elif hs_state == "ready" and len(data) == 24:
        ball  = decode_ball(data)
        delay = ball["reps"] / max(ball["bpm"] / 60.0, 0.1)
        log.info(
            f"  BALL  upper={ball['upper_rpm']} rpm  lower={ball['lower_rpm']} rpm  "
            f"height~{ball['height']}  drop~{ball['drop']}  "
            f"bpm~{ball['bpm']}  reps={ball['reps']}"
        )
        asyncio.get_event_loop().call_later(
            delay, lambda d=delay: asyncio.ensure_future(_send_done(d))
        )
    else:
        log.info(f"  (unhandled in state={hs_state})")


async def _send_done(delay):
    log.info(f"-> TX: DONE  (after {delay:.1f}s)")
    await send_notify(MSG_DONE)


def on_write_requested(sender, args):
    asyncio.ensure_future(handle_write(args))


async def main():
    global hs_state, notify_char

    s_guid = _uuid.UUID(SERVICE_UUID)
    n_guid = _uuid.UUID(UUID_N)
    w_guid = _uuid.UUID(UUID_W)

    svc_result = await gatt.GattServiceProvider.create_async(s_guid)
    if svc_result.error != bt.BluetoothError.SUCCESS:
        log.error(f"Failed to create service: {svc_result.error}")
        return
    provider = svc_result.service_provider

    n_params = gatt.GattLocalCharacteristicParameters()
    n_params.characteristic_properties = (
        gatt.GattCharacteristicProperties.NOTIFY |
        gatt.GattCharacteristicProperties.READ
    )
    n_params.read_protection_level  = gatt.GattProtectionLevel.PLAIN
    n_params.write_protection_level = gatt.GattProtectionLevel.PLAIN
    n_result = await provider.service.create_characteristic_async(n_guid, n_params)
    if n_result.error != bt.BluetoothError.SUCCESS:
        log.error(f"Failed to create notify char: {n_result.error}")
        return
    notify_char = n_result.characteristic

    w_params = gatt.GattLocalCharacteristicParameters()
    w_params.characteristic_properties = (
        gatt.GattCharacteristicProperties.WRITE |
        gatt.GattCharacteristicProperties.WRITE_WITHOUT_RESPONSE
    )
    w_params.read_protection_level  = gatt.GattProtectionLevel.PLAIN
    w_params.write_protection_level = gatt.GattProtectionLevel.PLAIN
    w_result = await provider.service.create_characteristic_async(w_guid, w_params)
    if w_result.error != bt.BluetoothError.SUCCESS:
        log.error(f"Failed to create write char: {w_result.error}")
        return
    w_result.characteristic.add_write_requested(on_write_requested)

    provider.start_advertising()

    hs_state = "handshake"
    log.info("=" * 54)
    log.info("  Nova Robot Emulator -- advertising as NOVA-EMU")
    log.info(f"  Serial:  {SERIAL}   Code: {CODE}")
    log.info(f"  Service: {SERVICE_UUID}")
    log.info(f"  Write:   {UUID_W}")
    log.info(f"  Notify:  {UUID_N}")
    log.info("=" * 54)

    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Emulator stopped.")
