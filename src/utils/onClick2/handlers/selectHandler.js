const processSelectComponent = (component, apiData) => {
  if (!component.data?.url) {
    return component;
  }

  return {
    ...component,
    data: {
      ...component.data,
      values: apiData?.graph?.[component.key] || []
    }
  };
};

module.exports = processSelectComponent;
