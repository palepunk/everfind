let activeHouseSwitchInProgress = false;

export const setActiveHouseSwitchInProgress = (value: boolean) => {
  activeHouseSwitchInProgress = value;
};

export const isActiveHouseSwitchInProgress = () => activeHouseSwitchInProgress;
