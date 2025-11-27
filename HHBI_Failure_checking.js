// ============================
// 1. Global State & Setup
// ============================
let alvinMapData = {}; 
const gridContainer = document.getElementById('grid');
const tooltip = document.getElementById('tooltip');
let activeCell = null;

// สร้าง Grid 96 ช่อง
for (let i = 1; i <= 96; i++) {
    let cell = document.createElement('div');
    cell.classList.add('grid-cell');
    cell.id = `cell-${i}`; 
    cell.innerHTML = i;
    cell.addEventListener('click', function(e) { e.stopPropagation(); showTooltip(cell, i); });
    gridContainer.appendChild(cell);
}
// ช่องพิเศษ
["Gato1","Gato2","Gato3","Gato4"].forEach(l => createExtraCell('wide-cell', l));
createExtraCell('footer-left', "Narwhal");
createExtraCell('footer-right', "Chopper");

function createExtraCell(cls, txt) {
    let c = document.createElement('div'); c.className = cls; c.innerHTML = txt;
    gridContainer.appendChild(c);
}

// ============================
// 2. Processing Logic
// ============================
let fileInput = document.getElementById("myFile");
let processBtn = document.getElementById("processBtn");

processBtn.addEventListener("click", function() {
    if (!fileInput.files || !fileInput.files[0]) { alert("⚠️ Please select a CSV file first"); return; }
    
    processBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    processBtn.style.opacity = "0.7";
    
    setTimeout(() => { processFile(); }, 100);
});

function processFile() {
    let reader = new FileReader();
    reader.onload = function(e) {
        alvinMapData = {};
        for(let i=1; i<=96; i++) alvinMapData[i] = { status: 'ok', details: [] };
        document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('error', 'active'));

        let text = e.target.result;
        let rows = text.split(/\r\n|\n/); 
        let extractedData = [];

        for (let i = 1; i < rows.length; i++) {
            let row = rows[i]; if (row.trim() === "") continue;
            let cols = parseCSVLine(row);
            if (cols.length > 5) {
                let loop = (cols[2].match(/Loop\s+(\d+)/) || [0,"0"])[1];
                let sn = (cols[3].match(/SN=([^,"]+)/) || [0,"Unknown"])[1];
                let alvin = (cols[4].match(/Alvin(\d+)/) || [0,"0"])[1];
                let ch = (cols[4].match(/(CH\d+)/) || [0,"-"])[1];
                let val = (cols[5].match(/value='([^']+)'/) || [0,"0"])[1];
                let lower = (cols[5].match(/lower_limit='([^']+)'/) || [0,"0"])[1];
                let upper = (cols[5].match(/upper_limit='([^']+)'/) || [0,"0"])[1];

                extractedData.push({ Loop: loop, SN: sn, Label: cols[4], AlvinID: alvin, Channel: ch, Value: parseFloat(val), Lower: parseFloat(lower), Upper: parseFloat(upper) });
            }
        }
        extractedData.sort((a, b) => a.SN.localeCompare(b.SN) || (parseInt(a.Loop) - parseInt(b.Loop)));

        createTable(extractedData);
        analyzeAllIssues(extractedData); 
        
        processBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Run Analysis';
        processBtn.style.opacity = "1";
    };
    reader.readAsText(fileInput.files[0]);
}

// ============================
// 3. Analysis Logic (Priority System)
// ============================
function analyzeAllIssues(data) {
    let stats = prepareStats(data);
    let reports = new Set();
    
    let alvinFailCount = {}; 
    // 🔥 Set เก็บรายชื่อ Alvin ที่เข้าข่าย MC (อาการหนัก)
    let criticalAlvins = new Set();

    const recordIssue = (idStr, msg, type) => {
        let id = parseInt(idStr);
        if (alvinMapData[id]) {
            alvinMapData[id].status = 'error';
            alvinMapData[id].details.push({ type: type, msg: msg });
        }
    };

    // ------------------------------------------
    // 1. Check MC (Priority #1)
    // ------------------------------------------
    let mcFailedGlobal = false;

    for (let key in stats) {
        let s = stats[key];
        
        // ตรวจสอบประวัติทุกบรรทัด: มีลูปไหนบ้างที่เข้าเงื่อนไข MC?
        let mcLoops = new Set();

        s.history.forEach(r => {
            // เงื่อนไข: Limit 0-1 และ ค่า > 190
            let isMCLimit = (r.lower === 0 && r.upper === 1);
            let isCriticalVal = (r.val > 190);

            if (isMCLimit && isCriticalVal) {
                mcLoops.add(r.loop); // จดว่าลูปนี้พังแบบ MC
            }
        });

        // ถ้าเจอครบ 4 ลูป (0, 1, 2, 3) -> ถือว่าเป็น IssueMC
        if (mcLoops.has("0") && mcLoops.has("1") && mcLoops.has("2") && mcLoops.has("3")) {
            mcFailedGlobal = true;
            criticalAlvins.add(s.alvinID); // 🔥 ขึ้นบัญชีดำไว้
            recordIssue(s.alvinID, `[MC] Critical (Val > 190 in 4 Loops)`, 'MC');
        }
    }

    if (mcFailedGlobal) {
        reports.add(`🛑 <strong>[IssueMC]</strong> <span style="color:#e74c3c; font-weight:bold;">Should Replace Mackerel</span>`);
    }

    // ------------------------------------------
    // 2. Check Alvin (Priority #2)
    // ------------------------------------------
    for (let key in stats) {
        let s = stats[key];
        
        // 🔥 เช็คก่อน: ถ้า Alvin ตัวนี้โดนข้อหา MC ไปแล้ว -> ข้ามเลย!
        if (criticalAlvins.has(s.alvinID)) continue;

        let fails = [];
        s.history.forEach(r => {
            // เช็ค Limit ของบรรทัดนั้นๆ
            let upper = r.upper;
            let lower = r.lower;

            let over = (r.val > upper && r.val <= upper + 10.0);
            let under = (r.val < lower && r.val >= lower - 10.0);
            
            // เพิ่มเงื่อนไข: ต้องไม่ใช่เคส MC (กันพลาด)
            let notMC = !(r.val > 190 && lower === 0 && upper === 1);

            if ((over || under) && notMC) {
                fails.push({l: r.loop, v: r.val});
            }
        });

        if (fails.length > 0) {
            fails.forEach(f => {
                recordIssue(s.alvinID, `[Alvin] ${s.channel} Loop ${f.l} : ${f.v}`, 'Alvin');
            });

            if (!alvinFailCount[s.alvinID]) {
                alvinFailCount[s.alvinID] = { sn: s.sn, count: 0 };
            }
            alvinFailCount[s.alvinID].count++;
        }
    }

    // สร้างคำแนะนำสำหรับ Alvin (เฉพาะตัวที่ไม่ใช่ MC)
    for (let id in alvinFailCount) {
        let item = alvinFailCount[id];
        reports.add(`🔧 <strong>[IssueAlvin]</strong> <strong>Replace Alvin${id}</strong> ➜ SN: ${item.sn}`);
    }

    // Render Map
    for (let i = 1; i <= 96; i++) {
        if (alvinMapData[i].status === 'error') {
            let cell = document.getElementById(`cell-${i}`);
            if (cell) cell.classList.add('error');
        }
    }

    // Display
    let list = document.getElementById("recommendationList");
    let box = document.getElementById("recommendationBox");
    list.innerHTML = "";
    if (reports.size > 0) {
        box.style.display = "block";
        reports.forEach(msg => { let li = document.createElement("li"); li.innerHTML = msg; list.appendChild(li); });
    } else { box.style.display = "none"; }
}

// --- Helper Functions ---
// 🔥 แก้ไข: เก็บ Limit รายบรรทัด ไม่ใช่ราย Channel
function prepareStats(data) {
    let stats = {};
    data.forEach(item => {
        let k = `${item.SN}|${item.AlvinID}|${item.Channel}`;
        if (!stats[k]) {
            // ไม่เก็บ lower/upper ตรงนี้แล้ว เพราะมันเปลี่ยนไปมาได้
            stats[k] = { sn: item.SN, alvinID: item.AlvinID, channel: item.Channel, history: [] };
        }
        // ยัด Limit ลงไปใน history แทน
        stats[k].history.push({ 
            loop: item.Loop, 
            val: item.Value, 
            lower: item.Lower, 
            upper: item.Upper 
        });
    });
    return stats;
}

function showTooltip(cell, id) {
    if (activeCell) activeCell.classList.remove('active');
    activeCell = cell; cell.classList.add('active');
    let data = alvinMapData[id];
    let content = "";
    if (data && data.status === 'error') {
        content = `<strong>❌ Unit ${id} : Issues Found</strong><br><ul style='margin-top:5px; padding-left:15px; margin-bottom:0;'>`;
        let uniqueDetails = [...new Set(data.details.map(d => d.msg))];
        uniqueDetails.slice(0, 7).forEach(msg => content += `<li>${msg}</li>`);
        if(uniqueDetails.length > 7) content += `<li>...and ${uniqueDetails.length - 7} more...</li>`;
        content += "</ul>";
        tooltip.style.backgroundColor = "#c0392b";
    } else {
        content = `<strong>✅ Alvin ${id} : Normal</strong><br><small>No issues detected</small>`;
        tooltip.style.backgroundColor = "#2c3e50";
    }
    tooltip.innerHTML = content;
    const rect = cell.getBoundingClientRect();
    const top = rect.top + window.scrollY - tooltip.offsetHeight - 10;
    const left = rect.left + window.scrollX + (rect.width / 2) - (tooltip.offsetWidth / 2);
    tooltip.style.top = `${top}px`; tooltip.style.left = `${left}px`; tooltip.classList.add('show');
}
function hideTooltip() { if (activeCell) activeCell.classList.remove('active'); tooltip.classList.remove('show'); }
document.addEventListener('click', (e) => { if(!e.target.closest('.grid-cell')) hideTooltip(); });

function createTable(data) {
    let displayLimit = 1000;
    let displayData = data.length > displayLimit ? data.slice(0, displayLimit) : data;
    let html = '<table><thead><tr><th>SN</th><th>Loop</th><th>Channel</th><th>Upper</th><th>Lower</th><th>Value</th></tr></thead><tbody>';
    for(let i=0; i<displayData.length; i++) {
        let isNewSN = (i===0 || displayData[i].SN !== displayData[i-1].SN);
        html += '<tr>';
        if(isNewSN) {
            let count = 1;
            for(let j=i+1; j<displayData.length; j++) { if(displayData[j].SN === displayData[i].SN) count++; else break; }
            html += `<td rowspan="${count}" class="sn-cell">${displayData[i].SN}</td>`;
        }
        html += `<td>${displayData[i].Loop}</td><td>${displayData[i].Label}</td><td>${displayData[i].Upper}</td><td>${displayData[i].Lower}</td>`;
        let val = parseFloat(displayData[i].Value);
        let cls = "val-normal"; let icon = "";
        if(val > displayData[i].Upper) { cls = "val-high"; icon = " ⬆"; }
        else if(val < displayData[i].Lower) { cls = "val-low"; icon = " ⬇"; }
        html += `<td><span class="${cls}">${val}${icon}</span></td></tr>`;
    }
    if(data.length > displayLimit) html += `<tr><td colspan="6" style="text-align:center; color:gray;">... แสดงผลเพียง ${displayLimit} รายการแรก ...</td></tr>`;
    html += '</tbody></table>';
    document.getElementById("tableContainer").innerHTML = html;
}
function parseCSVLine(text) {
    let ret = ['']; let i = 0, p = '', s = true;
    for (let x = 0; x < text.length; x++) {
        let l = text[x];
        if ('"' === l) { s = !s; if ('"' === p) { ret[i] += '"'; l = '-'; } else if ('' === p) l = '-'; } else if (s && ',' === l) l = ret[++i] = ''; else ret[i] += l;
        p = l;
    }
    return ret;

}
