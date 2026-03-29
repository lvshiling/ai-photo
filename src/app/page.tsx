import Link from 'next/link';

export default function Main() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
      <div className="flex w-full max-w-4xl justify-center mb-12 mt-8">
        <h1 className="text-4xl font-bold text-gray-800 tracking-tight">AI Tools Collection</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {/* ID-Photo Tool Card */}
        <Link 
          href="/id-photo" 
          className="group flex flex-col items-center bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-300 hover:-translate-y-1 transition-all cursor-pointer text-center"
        >
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">
            📸
          </div>
          <h2 className="text-xl font-semibold mb-2 text-gray-800">AI ID Photo Maker</h2>
          <p className="text-sm text-gray-500">Smart background removal & standard ID photo generation</p>
        </Link>
        
        {/* Coming Soon Placeholder */}
        <div className="flex flex-col items-center bg-gray-100/50 p-8 rounded-2xl border border-gray-200 border-dashed text-center opacity-80">
          <div className="w-16 h-16 bg-gray-200 text-gray-500 rounded-2xl flex items-center justify-center text-3xl mb-4">
            ✨
          </div>
          <h2 className="text-xl font-semibold mb-2 text-gray-500">More Tools</h2>
          <p className="text-sm text-gray-400">Coming soon...</p>
        </div>
      </div>

      <footer className="w-full max-w-4xl mt-auto pt-16 flex flex-col items-center text-gray-500 mb-8">
        <p className="mb-4 text-sm font-medium">✨ 关注跨服寻宝小红书获取更多免费工具</p>
        <div className="bg-white p-2 rounded-xl shadow-sm border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/qrcode.jpg" alt="小红书 跨服寻宝" className="w-48 h-auto rounded-lg" />
        </div>
        <p className="mt-3 text-xs text-gray-400">小红书号：95009831256</p>
      </footer>
    </main>
  );
}
