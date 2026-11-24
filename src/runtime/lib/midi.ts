/**
 * Web MIDI wiring. RtMidi's Emscripten port reaches for these globals directly
 * rather than through our Module, so this installs them on `window`.
 */

interface RtMidiWindow extends Window {
    _rtmidi_internals_midi_access: MIDIAccess;
    _rtmidi_internals_latest_message_timestamp: number;
    _rtmidi_internals_waiting: boolean;
    _rtmidi_internals_get_port_by_number: (portNumber: number, isInput: boolean) => MIDIPort | null;
}

export function installMidiAccess(access: MIDIAccess): void {
    const w = window as unknown as RtMidiWindow;
    w._rtmidi_internals_midi_access = access;
    w._rtmidi_internals_latest_message_timestamp = 0.0;
    w._rtmidi_internals_waiting = false;
    w._rtmidi_internals_get_port_by_number = (portNumber, isInput) => {
        const devices = isInput ? access.inputs : access.outputs;
        let i = 0;
        for (const device of devices.values()) {
            if (i === portNumber) return device;
            i++;
        }
        return null;
    };
}
