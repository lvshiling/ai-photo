async function go() {
    try {
        let res = await fetch("https://huggingface.co/api/models?search=document&filter=onnx");
        let items = await res.json();
        console.log("HF Success", items.slice(0, 5).map(it => it.modelId));
    } catch(e) { console.log("HF failed", e.message); }
}
go();