document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const courseTitleEl = document.getElementById('courseTitle');
  const moduleTitleEl = document.getElementById('moduleTitle');
  const courseIdEl = document.getElementById('courseId');
  const sltHashEl = document.getElementById('sltHash');
  const paletteEl = document.getElementById('palette');
  const lightInteriorEl = document.getElementById('lightInterior');
  const svgContainer = document.getElementById('svgContainer');

  // Populate Palette Dropdown
  window.PALETTES.forEach(pal => {
    const opt = document.createElement('option');
    opt.value = pal.slug;
    opt.textContent = pal.name;
    paletteEl.appendChild(opt);
  });
  
  // Set default palette
  paletteEl.value = window.PALETTES[0].slug;

  // Fallbacks if inputs are completely empty/invalid
  const FALLBACK_CID = "0".repeat(56);
  const FALLBACK_SLT = "0".repeat(64);

  function updatePreview() {
    let cid = courseIdEl.value.replace(/[^a-fA-F0-9]/g, '');
    if (cid.length === 0) cid = FALLBACK_CID;
    
    let slt = sltHashEl.value.replace(/[^a-fA-F0-9]/g, '');
    if (slt.length === 0) slt = FALLBACK_SLT;

    const inputs = {
      courseTitle: courseTitleEl.value || "Untitled Course",
      moduleTitle: moduleTitleEl.value || "Untitled Module",
      courseId: cid,
      sltHash: slt,
      palId: paletteEl.value,
      isLight: lightInteriorEl.checked
    };

    // Dynamically update the page title so "Save as PDF" uses the module title as the default filename
    document.title = `${inputs.moduleTitle} - Andamio Credential`;

    // Render SVG and inject
    const svgString = window.renderSvg(inputs);
    svgContainer.innerHTML = svgString;
  }

  // Attach Listeners
  [courseTitleEl, moduleTitleEl, courseIdEl, sltHashEl].forEach(el => {
    el.addEventListener('input', updatePreview);
  });
  
  paletteEl.addEventListener('change', updatePreview);
  lightInteriorEl.addEventListener('change', updatePreview);

  const randomCourseBtn = document.getElementById('randomCourseBtn');
  let coursesData = [];

  function loadRandomCourse() {
    if (coursesData.length === 0) return;
    const randomIdx = Math.floor(Math.random() * coursesData.length);
    const item = coursesData[randomIdx];
    
    courseTitleEl.value = item.course_title;
    moduleTitleEl.value = item.module_title;
    courseIdEl.value = item.course_id;
    sltHashEl.value = item.slt_hash;
    
    // Trigger spin animation
    randomCourseBtn.classList.remove('spin-anim');
    void randomCourseBtn.offsetWidth; // Force a reflow
    randomCourseBtn.classList.add('spin-anim');
    
    updatePreview();
  }

  fetch('assets/courses.json')
    .then(res => res.json())
    .then(data => { 
      coursesData = data;
      loadRandomCourse();
    })
    .catch(err => console.error("Failed to load courses:", err));

  randomCourseBtn.addEventListener('click', loadRandomCourse);

  const downloadPdfBtn = document.getElementById('downloadPdfBtn');
  
  downloadPdfBtn.addEventListener('click', () => {
    window.print();
  });

  // Initial Render
  updatePreview();

  // Mobile Menu Toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.querySelector('.sidebar');
  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
});
