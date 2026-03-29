const fs = require('fs');

let content = fs.readFileSync('src/app/passport/page.tsx', 'utf8');

// Update generatePDF
content = content.replace(
  `  const generatePDF = () => {
    if (!canvasRef.current) return;
    if (!hasAutoCropped && (!crop || crop.width === 0)) return;`,
  `  const generatePDF = () => {
    if (!canvasRef.current || !anchorPoints) return;`
);

content = content.replace(
  `          disabled={!imageSrc || (!hasAutoCropped && (!crop || crop.width === 0))}`,
  `          disabled={!imageSrc || !anchorPoints}`
);

// Replace the main split layout
const startJsx = `{imageSrc ? (`;
const endJsx = `      ) : (`;
const jsxStartIndex = content.indexOf(startJsx);
const jsxEndIndex = content.indexOf(endJsx);

const newJsx = `{imageSrc ? (
        <div className="flex flex-col md:flex-row gap-8 items-start w-full max-w-5xl justify-center mt-4">
          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">   
            <h2 className="mb-3 font-semibold text-gray-700">{lang === 'zh' ? '调整四角提取文档' : 'Adjust 4 corners to extract document'}</h2>
            <div className="p-2 bg-white rounded-lg shadow-sm border w-full flex justify-center">
                <div 
                  className="relative inline-block border border-gray-200 shadow-sm rounded-lg" 
                  style={{ touchAction: 'none' }}
                  onPointerMove={handleSvgPointerMove}
                  onPointerUp={handleSvgPointerUp}
                  onPointerLeave={handleSvgPointerUp}
                >
                  <img
                    ref={imageRef}
                    src={originalImageSrc || imageSrc}
                    alt="Original Passport"
                    className="max-h-[500px] w-auto h-auto block select-none pointer-events-none"
                    onLoad={updatePreviewCanvas}
                    crossOrigin="anonymous"
                  />
                  {anchorPoints && imageDims && (
                    <svg
                      ref={svgRef}
                      className="absolute top-0 left-0 w-full h-full z-10"
                      viewBox={\`0 0 \${imageDims.w} \${imageDims.h}\`}
                      preserveAspectRatio="none"
                    >
                      <polygon
                        points={anchorPoints.map(p => \`\${p.x},\${p.y}\`).join(' ')}
                        fill="rgba(16, 185, 129, 0.2)"
                        stroke="#10b981"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                        className="pointer-events-none"
                      />
                      {anchorPoints.map((pt, i) => (
                        <circle
                          key={i}
                          cx={pt.x}
                          cy={pt.y}
                          r={Math.max(10, imageDims.w * 0.02)}
                          fill="white"
                          stroke="#10b981"
                          strokeWidth={Math.max(2, imageDims.w * 0.005)}
                          className="cursor-pointer transition-transform hover:scale-110"
                          onPointerDown={(e) => handleSvgPointerDown(e, i)}
                        />
                      ))}
                    </svg>
                  )}
                </div>
            </div>
            <p className="mt-4 text-xs text-emerald-700 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100 shadow-sm text-center">
              {lang === 'zh' ? '💡 提示：拖拽四角蓝点对齐文档边缘' : '💡 Tip: Drag the 4 corners to fit document edges.'}
            </p>
          </div>

          <div className="flex flex-col items-center flex-1 w-full md:w-1/2">   
            <h2 className="mb-3 font-semibold text-gray-700">{t.pspPreview}</h2>
            <div className="p-4 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg w-full min-h-[400px] flex items-center justify-center relative overflow-hidden shadow-inner">
              <canvas
                ref={canvasRef}
                className={\`max-w-[100%] max-h-[500px] shadow-lg bg-white object-contain border border-gray-300 \${anchorPoints ? 'block' : 'hidden'}\`}
              />
              {!anchorPoints && (
                <span className="text-gray-400 absolute font-medium">
                  {lang === 'zh' ? '请在左侧调整以预览' : 'Adjust points to preview'}
                </span>
              )}
            </div>
          </div>
        </div>
`;

content = content.substring(0, jsxStartIndex) + newJsx + content.substring(jsxEndIndex);
fs.writeFileSync('src/app/passport/page.tsx', content);
console.log('Update 3 done');
