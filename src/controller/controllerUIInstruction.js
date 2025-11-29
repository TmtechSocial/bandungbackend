const handleUIInstruction = async (clickData) => {
  try {
    const { eventData, customType, affects } = clickData;
    
    // Log UI instruction untuk dibaca frontend
    const uiInstructionLog = {
      type: 'UI_INSTRUCTION',
      timestamp: new Date().toISOString(),
      instruction: {
        componentType: customType,
        targetField: affects,
        eventData: eventData
      },
      status: 'PENDING'
    };

    // Simpan log (bisa ke database atau memory store)
    console.log('UI Instruction Log:', JSON.stringify(uiInstructionLog, null, 2));

    return {
      success: true,
      message: 'UI instruction logged successfully',
      data: uiInstructionLog
    };
  } catch (error) {
    console.error('Error handling UI instruction:', error);
    throw new Error(`Failed to process UI instruction: ${error.message}`);
  }
};

module.exports = {
  handleUIInstruction
};
