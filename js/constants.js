export const SERVICE_UUID = 0xfeff;
export const UUID_S = "02f00000-0000-0000-0000-00000000fe00";
export const UUID_N = "02f00000-0000-0000-0000-00000000ff02";
export const UUID_W = "02f00000-0000-0000-0000-00000000ff01";
export const SALT = "Mjgx1jAwXDBaMFcxCz3JBgNVBAYT4kJF7Rkw";
export const MSG_DONE = "00020300050100";

export const CATEGORIES = {
    "custom-a": [], "custom-b": [], "custom-c": []
};

// Physics Constants
export const RPM_MIN = 400;
export const RPM_MAX = 7500;

// Constraints: Speed (Key) -> Max Spin (Value)
export const SPIN_LIMITS = {
    "0": 2, "0.5": 3, 
    "1": 4, "1.5": 5, 
    "2": 6, "2.5": 7, 
    "3": 8, "3.5": 9, 
    "4": 10, "4.5": 10, 
    "5": 9, "5.5": 8, 
    "6": 8, "6.5": 7, 
    "7": 6, "7.5": 5, 
    "8": 4, "8.5": 3, 
    "9": 2, "9.5": 1, 
    "10": 0
};