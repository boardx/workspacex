export const audioInputZhCN = {
  "audioInput.default": "系统默认麦克风",
  "audioInput.choose": "选择麦克风",
  "audioInput.empty": "未检测到其它输入设备。授权麦克风后会显示设备名。",
  "audioInput.anonymous": "麦克风 {count}（授权后显示名称）",
  "audioInput.title": "麦克风：{name}"
} as const;

export const audioInputEn = {
  "audioInput.default": "System default microphone",
  "audioInput.choose": "Choose microphone",
  "audioInput.empty": "No other input devices detected. Device names appear after microphone access is allowed.",
  "audioInput.anonymous": "Microphone {count} (name available after permission)",
  "audioInput.title": "Microphone: {name}"
} satisfies Record<keyof typeof audioInputZhCN, string>;
