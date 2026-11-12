"use client";

import { createContext, useContext } from "react";

/** Below this width the workspace stops being a split and becomes one scrolling page. */
export const PHONE_MAX_WIDTH = 640;

export interface PhoneMode {
  /** True on a phone: no fixed-height panes, the page itself scrolls. */
  phone: boolean;
  /** The video stays visible under the navigation bar while the notes scroll. */
  pinned: boolean;
}

export const PhoneModeContext = createContext<PhoneMode>({ phone: false, pinned: false });
export const usePhoneMode = () => useContext(PhoneModeContext);
