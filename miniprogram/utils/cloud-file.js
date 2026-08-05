function getTempFileUrl(fileId) {
  if (!fileId || typeof fileId !== "string") return Promise.resolve("");
  if (!fileId.startsWith("cloud://")) return Promise.resolve(fileId);
  if (typeof wx === "undefined" || !wx.cloud || typeof wx.cloud.getTempFileURL !== "function") {
    return Promise.resolve("");
  }
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: [fileId],
      success: (result) => {
        const item = result && Array.isArray(result.fileList) ? result.fileList[0] : null;
        resolve(item && item.tempFileURL ? item.tempFileURL : "");
      },
      fail: () => resolve("")
    });
  });
}

module.exports = { getTempFileUrl };
