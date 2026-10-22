// Catálogo de SUGESTÕES (não é uma trilha fixa): serve para autocompletar e para sugerir rodízios/temas
// quando a IA não está conectada. O médico pode digitar qualquer residência, rodízio, área ou tema.
// - `rodizios`: rodízios comuns da residência no Brasil (para residentes). `anos` = anos em que costuma acontecer.
//   Fontes: Resolução CNRM nº 5/2023 (Clínica Médica), Resolução CNRM nº 48/2018 e matriz de Cirurgia Geral (MEC),
//   matriz FEBRASGO (GO), programa de referência da SBP (Pediatria) e grades publicadas de programas (USP, Unicamp, Unifesp).
//   A ordem e a duração variam entre programas — por isso o app também aceita "outro rodízio".
// - `areas`: áreas de atuação, para especialistas e professores.
// `q` é o trecho de busca (em inglês) aplicado ao TÍTULO dos artigos no Europe PMC.
const t = (pt, q) => ({ pt, q });

const TEMAS_BARIATRICA = [
  t("Sleeve x bypass gástrico", '(sleeve OR "gastric bypass") AND (comparison OR versus OR randomized)'),
  t("Agonistas de GLP-1 e cirurgia", '(bariatric OR "metabolic surgery") AND (GLP-1 OR semaglutide OR tirzepatide)'),
  t("Refluxo após sleeve", "sleeve AND (reflux OR GERD)"),
  t("Cirurgia revisional", '"revisional" AND (bariatric OR sleeve OR bypass)'),
  t("Diabetes tipo 2 e cirurgia metabólica", '("metabolic surgery" OR bariatric) AND diabetes'),
  t("Deficiências nutricionais pós-bariátrica", "bariatric AND (deficiency OR micronutrient OR nutritional)"),
];

const ESPECIALIDADES = {
  cirurgia: {
    nome: "Cirurgia Geral",
    duracao: 3,
    rodizios: [
      { id: "ps-cir", nome: "Pronto-socorro cirúrgico", anos: [1, 2], temas: [
        t("Abdome agudo", '"acute abdomen"'),
        t("Apendicite aguda", "appendicitis"),
        t("Colecistite aguda", "cholecystitis"),
        t("Obstrução intestinal", '"bowel obstruction" OR "intestinal obstruction"'),
        t("Hérnia encarcerada", '"incarcerated hernia" OR "strangulated hernia"'),
        t("Úlcera péptica perfurada", '"perforated peptic ulcer" OR "perforated ulcer"'),
      ]},
      { id: "trauma", nome: "Trauma", anos: [1, 2], temas: [
        t("Atendimento inicial (ATLS)", 'trauma AND ("primary survey" OR "initial assessment" OR ATLS)'),
        t("Trauma abdominal", '"abdominal trauma"'),
        t("Trauma torácico", '"chest trauma" OR "thoracic trauma"'),
        t("Choque hemorrágico", '"hemorrhagic shock" OR "massive transfusion"'),
        t("Controle de danos", '"damage control"'),
        t("Traumatismo cranioencefálico", '"traumatic brain injury"'),
      ]},
      { id: "enf-cir", nome: "Enfermaria de cirurgia geral", anos: [1], temas: [
        t("Complicações pós-operatórias", '"postoperative complications"'),
        t("Infecção de sítio cirúrgico", '"surgical site infection"'),
        t("Tromboprofilaxia cirúrgica", "thromboprophylaxis AND surgery"),
        t("ERAS / recuperação acelerada", '"enhanced recovery" OR ERAS'),
        t("Fluidoterapia perioperatória", '"perioperative fluid" OR "goal-directed fluid"'),
        t("Nutrição perioperatória", '"perioperative nutrition" OR "preoperative nutrition"'),
      ]},
      { id: "uti-cir", nome: "UTI", anos: [1, 2], temas: [
        t("Sepse e choque séptico", "sepsis OR \"septic shock\""),
        t("Vasopressores", "vasopressor OR norepinephrine"),
        t("Ventilação mecânica", '"mechanical ventilation"'),
        t("Ressuscitação volêmica", '"fluid resuscitation"'),
        t("Nutrição no paciente crítico", '"critically ill" AND nutrition'),
      ]},
      { id: "vascular", nome: "Cirurgia vascular", anos: [1], temas: [
        t("Doença arterial periférica", '"peripheral artery disease" OR "peripheral arterial disease"'),
        t("Isquemia aguda de membro", '"acute limb ischemia"'),
        t("Trombose venosa profunda", '"deep vein thrombosis"'),
        t("Aneurisma de aorta abdominal", '"abdominal aortic aneurysm"'),
        t("Pé diabético", '"diabetic foot"'),
        t("Fístula arteriovenosa para hemodiálise", '"arteriovenous fistula" AND hemodialysis'),
      ]},
      { id: "uro", nome: "Urologia", anos: [1], temas: [
        t("Litíase urinária", 'urolithiasis OR "kidney stones" OR "ureteral stones"'),
        t("Hiperplasia prostática / retenção urinária", '"benign prostatic hyperplasia" OR "urinary retention"'),
        t("Escroto agudo / torção testicular", '"testicular torsion" OR "acute scrotum"'),
        t("Trauma urológico", '"renal trauma" OR "urologic trauma" OR "urethral injury"'),
      ]},
      { id: "toracica", nome: "Cirurgia torácica", anos: [1], temas: [
        t("Drenagem torácica", '"chest tube" OR "chest drain"'),
        t("Pneumotórax", "pneumothorax"),
        t("Derrame pleural e empiema", '"pleural empyema" OR "pleural infection" OR "pleural effusion"'),
        t("Nódulo pulmonar", '"pulmonary nodule"'),
      ]},
      { id: "colo", nome: "Coloproctologia", anos: [1, 2], temas: [
        t("Doença hemorroidária", "hemorrhoids OR hemorrhoidal"),
        t("Fissura anal", '"anal fissure"'),
        t("Abscesso e fístula anal", '"anal fistula" OR "perianal abscess"'),
        t("Diverticulite", "diverticulitis"),
        t("Doença pilonidal", "pilonidal"),
      ]},
      { id: "plastica", nome: "Cirurgia plástica e queimados", anos: [1], temas: [
        t("Queimaduras: reanimação e manejo", "burn AND (resuscitation OR management)"),
        t("Feridas complexas", '"chronic wounds" OR "wound healing"'),
        t("Lesão por pressão", '"pressure injury" OR "pressure ulcer"'),
      ]},
      { id: "ccp", nome: "Cirurgia de cabeça e pescoço", anos: [1, 2], temas: [
        t("Nódulo de tireoide", '"thyroid nodule"'),
        t("Câncer de tireoide", '"thyroid cancer"'),
        t("Traqueostomia", "tracheostomy"),
        t("Massas cervicais", '"neck mass"'),
      ]},
      { id: "anestesio-est", nome: "Anestesiologia (estágio)", anos: [1], temas: [
        t("Via aérea", '"airway management" OR "difficult airway"'),
        t("Avaliação pré-anestésica", '"preoperative assessment" OR "preoperative evaluation"'),
        t("Analgesia pós-operatória", '"postoperative pain" OR "postoperative analgesia"'),
      ]},
      { id: "cir-ped", nome: "Cirurgia pediátrica", anos: [1, 2], temas: [
        t("Estenose hipertrófica de piloro", '"pyloric stenosis"'),
        t("Invaginação intestinal", "intussusception"),
        t("Apendicite na criança", "appendicitis AND (children OR pediatric)"),
        t("Hérnia inguinal na criança", '"inguinal hernia" AND (children OR pediatric)'),
      ]},
      { id: "esofago", nome: "Esôfago e estômago", anos: [2], temas: [
        t("DRGE e hérnia de hiato", '"hiatal hernia" OR (reflux AND fundoplication)'),
        t("Câncer gástrico", '"gastric cancer"'),
        t("Câncer de esôfago", '"esophageal cancer"'),
        t("Acalasia", "achalasia"),
      ]},
      { id: "hbp", nome: "Fígado, vias biliares e pâncreas", anos: [2, 3], temas: [
        t("Coledocolitíase", "choledocholithiasis"),
        t("Lesão de via biliar", '"bile duct injury"'),
        t("Pancreatite necrosante", '"necrotizing pancreatitis" OR "infected necrosis"'),
        t("Tumores hepáticos", '"hepatocellular carcinoma" OR "colorectal liver metastases"'),
        t("Câncer de pâncreas", '"pancreatic cancer" OR "pancreatic ductal adenocarcinoma"'),
      ]},
      { id: "colorretal", nome: "Cirurgia colorretal", anos: [2, 3], temas: [
        t("Câncer colorretal", '"colorectal cancer"'),
        t("Câncer de reto", '"rectal cancer"'),
        t("Fístula anastomótica", '"anastomotic leak"'),
        t("Estomias", "stoma OR ostomy OR ileostomy"),
      ]},
      { id: "onco", nome: "Cirurgia oncológica", anos: [2, 3], temas: [
        t("Melanoma", "melanoma AND surgery"),
        t("Sarcoma de partes moles", '"soft tissue sarcoma"'),
        t("Câncer de mama (cirurgia)", '"breast cancer" AND surgery'),
      ]},
      { id: "endoscopia", nome: "Endoscopia digestiva", anos: [2], temas: [
        t("Hemorragia digestiva alta", '"upper gastrointestinal bleeding"'),
        t("Hemorragia digestiva baixa", '"lower gastrointestinal bleeding"'),
        t("CPRE", "ERCP"),
      ]},
      { id: "video", nome: "Videolaparoscopia", anos: [2, 3], temas: [
        t("Colecistectomia laparoscópica", '"laparoscopic cholecystectomy"'),
        t("Hérnia inguinal por vídeo (TEP/TAPP)", '"inguinal hernia" AND (TEP OR TAPP OR laparoscopic)'),
        t("Apendicectomia laparoscópica", '"laparoscopic appendectomy"'),
      ]},
      { id: "parede", nome: "Parede abdominal", anos: [3], temas: [
        t("Hérnia incisional", '"incisional hernia" OR "ventral hernia"'),
        t("Reconstrução da parede abdominal", '"abdominal wall reconstruction" OR "component separation"'),
        t("Tela profilática", '"prophylactic mesh"'),
      ]},
      { id: "bariatrica", nome: "Cirurgia bariátrica e metabólica", anos: [3], temas: TEMAS_BARIATRICA },
      { id: "transplante", nome: "Transplantes", anos: [3], temas: [
        t("Transplante hepático", '"liver transplantation"'),
        t("Transplante renal", '"kidney transplantation"'),
        t("Doação de órgãos e morte encefálica", '"organ donation" OR "brain death"'),
      ]},
    ],
    areas: {
      "Emergência e fundamentos": [
        t("Apendicite aguda", "appendicitis"),
        t("Colecistite aguda", "cholecystitis"),
        t("Obstrução intestinal", '"bowel obstruction" OR "intestinal obstruction"'),
        t("Pancreatite aguda", '"acute pancreatitis"'),
        t("Diverticulite", "diverticulitis"),
      ],
      "Cirurgia bariátrica e metabólica": TEMAS_BARIATRICA,
      "Hérnias e parede abdominal": [
        t("Hérnia inguinal", '"inguinal hernia"'),
        t("Hérnia incisional", '"incisional hernia" OR "ventral hernia"'),
        t("Tela profilática", '"prophylactic mesh"'),
      ],
      "Hepatobiliopancreática": [
        t("Coledocolitíase", "choledocholithiasis"),
        t("Lesão de via biliar", '"bile duct injury"'),
        t("Câncer de pâncreas", '"pancreatic cancer" OR "pancreatic ductal adenocarcinoma"'),
      ],
      "Coloproctologia": [
        t("Câncer colorretal", '"colorectal cancer"'),
        t("Fístula anastomótica", '"anastomotic leak"'),
        t("Doença hemorroidária", "hemorrhoids OR hemorrhoidal"),
      ],
      "Trauma": [
        t("Trauma abdominal", '"abdominal trauma"'),
        t("Controle de danos", '"damage control"'),
        t("Hemorragia no trauma", 'trauma AND (hemorrhage OR "massive transfusion")'),
      ],
      "Perioperatório": [
        t("ERAS / recuperação acelerada", '"enhanced recovery" OR ERAS'),
        t("Infecção de sítio cirúrgico", '"surgical site infection"'),
        t("Tromboprofilaxia cirúrgica", "thromboprophylaxis AND surgery"),
      ],
    },
  },

  clinica: {
    nome: "Clínica Médica",
    duracao: 2,
    // CNRM 5/2023: enfermaria geral ≥20%, enfermaria de especialidades ≥20%, ambulatório ≥30%,
    // urgência ≥20%, semi/UTI ≥10%; obrigatórios Cardio, Gastro, Nefro e Pneumo; demais opcionais.
    rodizios: [
      { id: "enf-cm", nome: "Enfermaria de Clínica Médica", anos: [1, 2], temas: [
        t("Pneumonia comunitária", '"community-acquired pneumonia"'),
        t("Insuficiência cardíaca descompensada", '"acute heart failure" OR "decompensated heart failure"'),
        t("Distúrbios do sódio", "hyponatremia OR hypernatremia"),
        t("Lesão renal aguda", '"acute kidney injury"'),
        t("Delirium no paciente internado", "delirium AND (hospitalized OR inpatient)"),
      ]},
      { id: "ps-cm", nome: "Pronto-socorro / Urgência", anos: [1, 2], temas: [
        t("Sepse", "sepsis"),
        t("Dor torácica", '"chest pain" AND emergency'),
        t("Cetoacidose diabética", '"diabetic ketoacidosis" OR "hyperosmolar"'),
        t("Emergência hipertensiva", '"hypertensive emergency" OR "hypertensive crisis"'),
        t("AVC agudo", '"acute ischemic stroke"'),
        t("Tromboembolismo pulmonar", '"pulmonary embolism"'),
      ]},
      { id: "uti-cm", nome: "UTI / Semi-intensiva", anos: [1, 2], temas: [
        t("Choque séptico", '"septic shock"'),
        t("Ventilação mecânica", '"mechanical ventilation"'),
        t("SDRA", '"acute respiratory distress syndrome"'),
        t("Sedação e analgesia na UTI", 'sedation AND ("intensive care" OR "critically ill")'),
        t("Distúrbios ácido-base", '"acid-base"'),
      ]},
      { id: "amb-cm", nome: "Ambulatório de Clínica Médica", anos: [1, 2], temas: [
        t("Hipertensão arterial", "hypertension AND (management OR treatment)"),
        t("Diabetes tipo 2", '"type 2 diabetes" AND (treatment OR management)'),
        t("Dislipidemia", "dyslipidemia OR statin"),
        t("Obesidade (tratamento clínico)", "obesity AND (pharmacotherapy OR semaglutide OR tirzepatide)"),
        t("Cessação do tabagismo", '"smoking cessation"'),
      ]},
      { id: "cardio-cm", nome: "Cardiologia", anos: [1, 2], temas: [
        t("Síndrome coronariana aguda", '"acute coronary syndrome" OR "myocardial infarction"'),
        t("Fibrilação atrial", '"atrial fibrillation"'),
        t("Insuficiência cardíaca crônica", '"heart failure" AND (reduced OR therapy)'),
        t("Valvopatias", '"aortic stenosis" OR "valvular heart disease"'),
        t("Síncope", "syncope"),
      ]},
      { id: "gastro-cm", nome: "Gastroenterologia / Hepatologia", anos: [1, 2], temas: [
        t("Cirrose e complicações", 'cirrhosis AND (ascites OR "hepatic encephalopathy" OR variceal)'),
        t("Hemorragia digestiva alta", '"upper gastrointestinal bleeding"'),
        t("Doença inflamatória intestinal", '"inflammatory bowel disease" OR "ulcerative colitis" OR "Crohn"'),
        t("Esteatose hepática (MASLD)", 'MASLD OR NAFLD OR "fatty liver"'),
        t("Hepatites virais", '"hepatitis B" OR "hepatitis C"'),
      ]},
      { id: "nefro-cm", nome: "Nefrologia", anos: [1, 2], temas: [
        t("Doença renal crônica", '"chronic kidney disease"'),
        t("Distúrbios do potássio", "hyperkalemia OR hypokalemia"),
        t("Glomerulopatias", 'glomerulonephritis OR "nephrotic syndrome"'),
        t("Indicação de diálise", "dialysis AND (initiation OR timing)"),
      ]},
      { id: "pneumo-cm", nome: "Pneumologia", anos: [1, 2], temas: [
        t("DPOC", '"chronic obstructive pulmonary disease" OR COPD'),
        t("Asma", "asthma AND adults"),
        t("Doença pulmonar intersticial", '"interstitial lung disease"'),
        t("Tuberculose", "tuberculosis AND treatment"),
      ]},
      { id: "endo-cm", nome: "Endocrinologia", anos: [1, 2], temas: [
        t("Hipo e hipertireoidismo", "hypothyroidism OR hyperthyroidism"),
        t("Insulinoterapia", "insulin AND (initiation OR inpatient OR basal)"),
        t("Insuficiência adrenal", '"adrenal insufficiency"'),
        t("Osteoporose", "osteoporosis"),
      ]},
      { id: "infecto-cm", nome: "Infectologia", anos: [1, 2], temas: [
        t("Antibioticoterapia racional", '"antimicrobial stewardship" OR "antibiotic duration"'),
        t("HIV", "HIV AND antiretroviral"),
        t("Infecção urinária", '"urinary tract infection"'),
        t("Endocardite infecciosa", '"infective endocarditis"'),
        t("Infecções de pele e partes moles", 'cellulitis OR "skin and soft tissue infection"'),
      ]},
      { id: "hemato-cm", nome: "Hematologia", anos: [1, 2], temas: [
        t("Anemias", "anemia AND (iron OR evaluation OR diagnosis)"),
        t("Anticoagulação", 'anticoagulation OR DOAC OR "direct oral anticoagulant"'),
        t("Neutropenia febril", '"febrile neutropenia"'),
        t("Plaquetopenia", "thrombocytopenia"),
      ]},
      { id: "reumato-cm", nome: "Reumatologia", anos: [1, 2], temas: [
        t("Artrite reumatoide", '"rheumatoid arthritis"'),
        t("Lúpus eritematoso sistêmico", '"systemic lupus erythematosus"'),
        t("Gota", "gout"),
        t("Vasculites", "vasculitis"),
      ]},
      { id: "neuro-cm", nome: "Neurologia", anos: [1, 2], temas: [
        t("AVC isquêmico", '"ischemic stroke"'),
        t("Estado de mal epiléptico", '"status epilepticus"'),
        t("Cefaleias", "migraine OR headache"),
        t("Meningite bacteriana", '"bacterial meningitis"'),
      ]},
      { id: "geriatria-cm", nome: "Geriatria", anos: [1, 2], temas: [
        t("Delirium", "delirium"),
        t("Quedas no idoso", 'falls AND ("older adults" OR elderly)'),
        t("Polifarmácia e desprescrição", "deprescribing OR polypharmacy"),
        t("Demência", "dementia"),
      ]},
      { id: "paliativos-cm", nome: "Cuidados paliativos", anos: [1, 2], temas: [
        t("Cuidados paliativos na enfermaria", '"palliative care"'),
        t("Controle de sintomas no fim de vida", '"end-of-life" AND symptom'),
      ]},
      { id: "dermato-cm", nome: "Dermatologia", anos: [1, 2], temas: [
        t("Farmacodermias graves", '"Stevens-Johnson" OR "toxic epidermal necrolysis" OR DRESS'),
        t("Psoríase", "psoriasis"),
      ]},
    ],
    areas: {
      "Fundamentos e enfermaria": [
        t("Sepse", "sepsis"),
        t("Pneumonia comunitária", '"community-acquired pneumonia"'),
        t("Insuficiência cardíaca descompensada", '"acute heart failure" OR "decompensated heart failure"'),
        t("Distúrbios do sódio", "hyponatremia OR hypernatremia"),
        t("Lesão renal aguda", '"acute kidney injury"'),
      ],
      "Doenças crônicas": [
        t("Hipertensão arterial", "hypertension AND (management OR treatment)"),
        t("Diabetes tipo 2", '"type 2 diabetes" AND (treatment OR management)'),
        t("Obesidade (tratamento clínico)", "obesity AND (pharmacotherapy OR semaglutide OR tirzepatide)"),
        t("DPOC", '"chronic obstructive pulmonary disease" OR COPD'),
      ],
      "Infectologia": [
        t("Antibioticoterapia racional", '"antimicrobial stewardship" OR "antibiotic duration"'),
        t("Infecção urinária", '"urinary tract infection"'),
      ],
    },
  },

  pediatria: {
    nome: "Pediatria",
    duracao: 3,
    rodizios: [
      { id: "aloj", nome: "Alojamento conjunto e sala de parto", anos: [1], temas: [
        t("Reanimação neonatal", '"neonatal resuscitation"'),
        t("Icterícia neonatal", '"neonatal jaundice" OR "neonatal hyperbilirubinemia"'),
        t("Aleitamento materno", "breastfeeding"),
        t("Triagem neonatal", '"newborn screening"'),
      ]},
      { id: "enf-ped", nome: "Enfermaria de pediatria", anos: [1, 2], temas: [
        t("Pneumonia na criança", 'pneumonia AND (children OR pediatric)'),
        t("Bronquiolite", "bronchiolitis"),
        t("Desidratação e gastroenterite", "gastroenteritis AND (children OR pediatric)"),
        t("Infecção urinária na criança", '"urinary tract infection" AND (children OR pediatric OR infants)'),
      ]},
      { id: "ps-ped", nome: "Pronto-socorro infantil", anos: [1, 2], temas: [
        t("Febre sem sinais localizatórios", '"febrile infant" OR "fever without source"'),
        t("Crise de asma", "asthma AND (exacerbation OR acute) AND (children OR pediatric)"),
        t("Convulsão febril", '"febrile seizure"'),
        t("Sepse pediátrica", 'sepsis AND (pediatric OR children)'),
        t("Anafilaxia", "anaphylaxis"),
      ]},
      { id: "ubs-ped", nome: "Puericultura / Atenção primária", anos: [1, 3], temas: [
        t("Desenvolvimento infantil", '"child development" OR "developmental surveillance"'),
        t("Vacinação", "vaccination AND (children OR infants)"),
        t("Anemia ferropriva", '"iron deficiency" AND (children OR infants)'),
        t("Obesidade infantil", '"childhood obesity" OR "pediatric obesity"'),
      ]},
      { id: "utin", nome: "UTI neonatal", anos: [2], temas: [
        t("Prematuridade", '"preterm infant" OR "very preterm"'),
        t("Sepse neonatal", '"neonatal sepsis"'),
        t("Desconforto respiratório do RN", '"respiratory distress syndrome" AND (neonatal OR preterm)'),
        t("Enterocolite necrosante", '"necrotizing enterocolitis"'),
      ]},
      { id: "utip", nome: "UTI pediátrica", anos: [2, 3], temas: [
        t("Choque séptico pediátrico", '"septic shock" AND (pediatric OR children)'),
        t("Ventilação mecânica em pediatria", '"mechanical ventilation" AND (pediatric OR children)'),
        t("TCE pediátrico", '"traumatic brain injury" AND (pediatric OR children)'),
        t("Cetoacidose diabética na criança", '"diabetic ketoacidosis" AND (children OR pediatric)'),
      ]},
      { id: "esp-ped", nome: "Ambulatório de especialidades", anos: [3], temas: [
        t("Cardiopatias congênitas", '"congenital heart disease"'),
        t("Síndrome nefrótica na criança", '"nephrotic syndrome" AND (children OR pediatric)'),
        t("Diabetes tipo 1", '"type 1 diabetes" AND (children OR adolescents)'),
        t("Alergia à proteína do leite de vaca", '"cow\'s milk allergy" OR "cow\'s milk protein allergy"'),
        t("Epilepsia na infância", "epilepsy AND (children OR pediatric)"),
      ]},
      { id: "adolesc", nome: "Medicina do adolescente", anos: [3], temas: [
        t("Saúde do adolescente", '"adolescent health"'),
        t("Transtornos alimentares", '"eating disorders" AND adolescents'),
      ]},
    ],
    areas: {
      "Fundamentos": [
        t("Bronquiolite", "bronchiolitis"),
        t("Febre sem sinais localizatórios", '"febrile infant" OR "fever without source"'),
        t("Desidratação e gastroenterite", "gastroenteritis AND (children OR pediatric)"),
        t("Asma na infância", "asthma AND (children OR pediatric)"),
      ],
      "Neonatologia": [
        t("Icterícia neonatal", '"neonatal jaundice" OR "neonatal hyperbilirubinemia"'),
        t("Sepse neonatal", '"neonatal sepsis"'),
      ],
    },
  },

  go: {
    nome: "Ginecologia e Obstetrícia",
    duracao: 3,
    rodizios: [
      { id: "co", nome: "Centro obstétrico", anos: [1, 2], temas: [
        t("Assistência ao trabalho de parto", '"labor management" OR intrapartum'),
        t("Hemorragia pós-parto", '"postpartum hemorrhage" OR "postpartum haemorrhage"'),
        t("Pré-eclâmpsia e eclâmpsia", "preeclampsia OR pre-eclampsia OR eclampsia"),
        t("Indução do parto", '"induction of labor" OR "labour induction"'),
      ]},
      { id: "pn-baixo", nome: "Pré-natal de baixo risco", anos: [1], temas: [
        t("Assistência pré-natal", '"prenatal care" OR "antenatal care"'),
        t("Ganho de peso na gestação", '"gestational weight gain"'),
        t("Suplementação na gestação", "pregnancy AND (supplementation OR folic OR iron)"),
      ]},
      { id: "ps-go", nome: "Pronto-socorro de GO", anos: [1, 2], temas: [
        t("Abortamento", '"early pregnancy loss" OR miscarriage'),
        t("Gravidez ectópica", '"ectopic pregnancy"'),
        t("Doença inflamatória pélvica", '"pelvic inflammatory disease"'),
        t("Hiperêmese gravídica", '"hyperemesis gravidarum"'),
      ]},
      { id: "gineco-geral", nome: "Ginecologia geral (ambulatório)", anos: [1], temas: [
        t("Sangramento uterino anormal", '"abnormal uterine bleeding"'),
        t("Vulvovaginites", "vaginitis OR \"bacterial vaginosis\" OR candidiasis"),
        t("Contracepção", "contraception OR contraceptive"),
        t("Rastreamento do câncer de colo", '"cervical cancer screening"'),
      ]},
      { id: "pn-alto", nome: "Pré-natal de alto risco", anos: [2], temas: [
        t("Diabetes gestacional", '"gestational diabetes"'),
        t("Restrição de crescimento fetal", '"fetal growth restriction"'),
        t("Prevenção do parto prematuro", '"preterm birth" AND prevention'),
        t("Gestação gemelar", '"twin pregnancy"'),
      ]},
      { id: "cir-gineco", nome: "Cirurgia ginecológica", anos: [2, 3], temas: [
        t("Miomatose uterina", '"uterine fibroids" OR leiomyoma'),
        t("Histerectomia", "hysterectomy"),
        t("Endometriose", "endometriosis"),
        t("Massas anexiais", '"adnexal mass" OR "ovarian cyst"'),
      ]},
      { id: "masto", nome: "Mastologia", anos: [2, 3], temas: [
        t("Rastreamento do câncer de mama", '"breast cancer screening"'),
        t("Nódulos mamários", '"breast mass" OR "breast lesion" OR "BI-RADS"'),
        t("Câncer de mama", '"breast cancer" AND (treatment OR management)'),
      ]},
      { id: "onco-gineco", nome: "Oncologia ginecológica", anos: [3], temas: [
        t("Câncer de colo do útero", '"cervical cancer"'),
        t("Câncer de endométrio", '"endometrial cancer"'),
        t("Câncer de ovário", '"ovarian cancer"'),
      ]},
      { id: "uroginecologia", nome: "Uroginecologia", anos: [3], temas: [
        t("Incontinência urinária feminina", '"urinary incontinence" AND women'),
        t("Prolapso de órgãos pélvicos", '"pelvic organ prolapse"'),
      ]},
      { id: "reproducao", nome: "Reprodução humana e endocrinologia ginecológica", anos: [3], temas: [
        t("Infertilidade", "infertility"),
        t("Síndrome dos ovários policísticos", '"polycystic ovary syndrome"'),
        t("Climatério e terapia hormonal", 'menopause AND "hormone therapy"'),
      ]},
    ],
    areas: {
      "Obstetrícia": [
        t("Pré-eclâmpsia", "preeclampsia OR pre-eclampsia"),
        t("Hemorragia pós-parto", '"postpartum hemorrhage" OR "postpartum haemorrhage"'),
        t("Diabetes gestacional", '"gestational diabetes"'),
      ],
      "Ginecologia": [
        t("Endometriose", "endometriosis"),
        t("Sangramento uterino anormal", '"abnormal uterine bleeding"'),
      ],
    },
  },

  emergencia: {
    nome: "Medicina de Emergência",
    duracao: 3,
    rodizios: [
      { id: "sala-vermelha", nome: "Sala de emergência", anos: [1, 2, 3], temas: [
        t("Parada cardiorrespiratória", '"cardiac arrest" OR "cardiopulmonary resuscitation"'),
        t("Via aérea na emergência", '"emergency airway" OR "rapid sequence intubation"'),
        t("Choque", "shock AND (management OR vasopressor)"),
        t("Taquiarritmias", "tachyarrhythmia OR \"supraventricular tachycardia\""),
      ]},
      { id: "trauma-em", nome: "Trauma", anos: [1, 2], temas: [
        t("Atendimento inicial (ATLS)", 'trauma AND ("primary survey" OR "initial assessment" OR ATLS)'),
        t("Choque hemorrágico", '"hemorrhagic shock" OR "massive transfusion"'),
        t("Traumatismo cranioencefálico", '"traumatic brain injury"'),
      ]},
      { id: "uti-em", nome: "UTI", anos: [2], temas: [
        t("Sepse", "sepsis"),
        t("Ventilação mecânica", '"mechanical ventilation"'),
      ]},
      { id: "ped-em", nome: "Emergência pediátrica", anos: [2], temas: [
        t("Febre sem sinais localizatórios", '"febrile infant" OR "fever without source"'),
        t("Convulsão febril", '"febrile seizure"'),
      ]},
      { id: "tox", nome: "Toxicologia", anos: [2, 3], temas: [
        t("Intoxicações agudas", "poisoning OR overdose"),
      ]},
      { id: "pocus", nome: "Ultrassom à beira-leito (POCUS)", anos: [1, 2, 3], temas: [
        t("POCUS na emergência", '"point-of-care ultrasound"'),
      ]},
      { id: "neuro-em", nome: "Emergências neurológicas e cardiovasculares", anos: [1, 2, 3], temas: [
        t("AVC agudo", '"acute ischemic stroke"'),
        t("Dor torácica", '"chest pain" AND emergency'),
      ]},
    ],
    areas: {
      "Fundamentos": [
        t("Parada cardiorrespiratória", '"cardiac arrest" OR "cardiopulmonary resuscitation"'),
        t("Via aérea na emergência", '"emergency airway" OR "rapid sequence intubation"'),
        t("Choque", "shock AND (management OR vasopressor)"),
        t("Dor torácica", '"chest pain" AND emergency'),
        t("AVC agudo", '"acute ischemic stroke"'),
      ],
      "Toxicologia": [t("Intoxicações agudas", "poisoning OR overdose")],
    },
  },

  anestesio: {
    nome: "Anestesiologia",
    duracao: 3,
    rodizios: [
      { id: "geral-an", nome: "Anestesia geral", anos: [1], temas: [
        t("Avaliação pré-anestésica", '"preoperative assessment" OR "preoperative evaluation"'),
        t("Via aérea difícil", '"difficult airway"'),
        t("Bloqueio neuromuscular e reversão", '"neuromuscular blockade" OR sugammadex'),
        t("Náuseas e vômitos pós-operatórios", '"postoperative nausea"'),
      ]},
      { id: "regional", nome: "Anestesia regional", anos: [1, 2], temas: [
        t("Bloqueios periféricos", '"nerve block" OR "regional anesthesia"'),
        t("Raquianestesia", '"spinal anesthesia"'),
      ]},
      { id: "obst-an", nome: "Anestesia obstétrica", anos: [2], temas: [
        t("Anestesia obstétrica", '"obstetric anesthesia" OR "labor analgesia"'),
      ]},
      { id: "ped-an", nome: "Anestesia pediátrica", anos: [2, 3], temas: [
        t("Anestesia pediátrica", '"pediatric anesthesia"'),
      ]},
      { id: "cardio-an", nome: "Anestesia cardíaca e torácica", anos: [3], temas: [
        t("Anestesia cardíaca", '"cardiac anesthesia" OR ("cardiac surgery" AND anesthesia)'),
        t("Ventilação monopulmonar", '"one-lung ventilation"'),
      ]},
      { id: "dor", nome: "Dor", anos: [2, 3], temas: [
        t("Analgesia pós-operatória", '"postoperative pain" OR "postoperative analgesia"'),
        t("Dor crônica", '"chronic pain" AND management'),
      ]},
    ],
    areas: {
      "Fundamentos": [
        t("Avaliação pré-anestésica", '"preoperative assessment" OR "preoperative evaluation"'),
        t("Via aérea difícil", '"difficult airway"'),
        t("Bloqueios periféricos", '"nerve block" OR "regional anesthesia"'),
        t("Náuseas e vômitos pós-operatórios", '"postoperative nausea"'),
      ],
    },
  },

  cardiologia: {
    nome: "Cardiologia",
    duracao: 2,
    rodizios: [
      { id: "uco", nome: "Unidade coronariana", anos: [1], temas: [
        t("Síndrome coronariana aguda", '"acute coronary syndrome" OR "myocardial infarction"'),
        t("Choque cardiogênico", '"cardiogenic shock"'),
      ]},
      { id: "ic", nome: "Insuficiência cardíaca", anos: [1, 2], temas: [
        t("Insuficiência cardíaca crônica", '"heart failure" AND (reduced OR therapy)'),
        t("IC com fração preservada", '"preserved ejection fraction"'),
      ]},
      { id: "arritmia", nome: "Arritmias / eletrofisiologia", anos: [1, 2], temas: [
        t("Fibrilação atrial", '"atrial fibrillation"'),
        t("Marca-passo e CDI", "pacemaker OR \"implantable cardioverter\""),
      ]},
      { id: "eco", nome: "Ecocardiografia", anos: [2], temas: [
        t("Valvopatias", '"aortic stenosis" OR "mitral regurgitation" OR "valvular heart disease"'),
      ]},
      { id: "hemo", nome: "Hemodinâmica", anos: [2], temas: [
        t("Intervenção coronária", '"percutaneous coronary intervention"'),
        t("TAVI", "TAVI OR TAVR OR \"transcatheter aortic\""),
      ]},
    ],
    areas: {
      "Fundamentos": [
        t("Síndrome coronariana aguda", '"acute coronary syndrome" OR "myocardial infarction"'),
        t("Fibrilação atrial", '"atrial fibrillation"'),
        t("Insuficiência cardíaca crônica", '"heart failure" AND (reduced OR therapy)'),
      ],
      "Prevenção": [t("Dislipidemia", "dyslipidemia OR LDL OR statin")],
    },
  },
};

const CARREIRA = [
  { id: "estudante", rotulo: "Estudante / internato", desc: "Quero uma base sólida", icone: "livro" },
  { id: "r1", rotulo: "Residente R1", desc: "Primeiro ano de residência", icone: "esteto", ano: 1 },
  { id: "r2", rotulo: "Residente R2", desc: "Segundo ano de residência", icone: "esteto", ano: 2 },
  { id: "r3", rotulo: "Residente R3 ou mais", desc: "Final da residência / subespecialização", icone: "esteto", ano: 3 },
  { id: "recem", rotulo: "Especialista recém-formado", desc: "Até ~5 anos de título", icone: "medalha" },
  { id: "experiente", rotulo: "Especialista experiente", desc: "Já focado na minha área de atuação", icone: "pulso" },
  { id: "professor", rotulo: "Professor / preceptor", desc: "Ensino residentes e alunos", icone: "capelo" },
  { id: "outro", rotulo: "Outro momento", desc: "Descreva com as suas palavras", icone: "lapis" },
];

// Grupo de perguntas de cada momento de carreira.
const GRUPO_DA_CARREIRA = { estudante: "estudante", r1: "residente", r2: "residente", r3: "residente", recem: "recem", experiente: "experiente", professor: "professor", outro: "outro" };

// Objetivos próprios de cada perfil. `modo` define o tipo de artigo (fundamentos, atualizacao, prova, ensino).
const OBJ_OUTRO = { id: "outro", rotulo: "Outro objetivo", desc: "Descreva com as suas palavras", icone: "lapis" };
const OBJETIVOS_POR_GRUPO = {
  estudante: [
    { id: "est-base", rotulo: "Entender bem a matéria", desc: "Base sólida para as provas da faculdade", icone: "livro", modo: "fundamentos" },
    { id: "est-internato", rotulo: "Ir bem no internato", desc: "O essencial para plantões e enfermarias", icone: "esteto", modo: "fundamentos" },
    { id: "est-residencia", rotulo: "Prova de residência", desc: "Temas e diretrizes mais cobrados", icone: "alvo", modo: "prova" },
    { id: "est-explorar", rotulo: "Conhecer especialidades", desc: "Descobrir áreas que combinam comigo", icone: "brilho", modo: "fundamentos" },
    OBJ_OUTRO,
  ],
  residente: [
    { id: "res-rodizio", rotulo: "Dominar o rodízio atual", desc: "Fundamentos práticos para o dia a dia", icone: "livro", modo: "fundamentos" },
    { id: "res-prova", rotulo: "Prova de R+ ou de título", desc: "Diretrizes e temas mais cobrados", icone: "alvo", modo: "prova" },
    { id: "res-ensinar", rotulo: "Ensinar internos e R-menores", desc: "Material de referência para ensinar", icone: "capelo", modo: "ensino" },
    { id: "res-atualizar", rotulo: "Me manter atualizado", desc: "O que é novo e muda condutas", icone: "brilho", modo: "atualizacao" },
    OBJ_OUTRO,
  ],
  recem: [
    { id: "rec-consolidar", rotulo: "Consolidar a base da especialidade", desc: "Revisões e diretrizes de referência", icone: "livro", modo: "fundamentos" },
    { id: "rec-pratica", rotulo: "Ganhar segurança na prática", desc: "Condutas para os casos do dia a dia", icone: "pulso", modo: "atualizacao" },
    { id: "rec-titulo", rotulo: "Prova de título", desc: "Diretrizes e temas mais cobrados", icone: "alvo", modo: "prova" },
    { id: "rec-atualizar", rotulo: "Me manter atualizado", desc: "O que é novo e relevante", icone: "brilho", modo: "atualizacao" },
    OBJ_OUTRO,
  ],
  experiente: [
    { id: "exp-novidades", rotulo: "Só o que é novo na minha área", desc: "Ensaios, meta-análises e diretrizes recentes", icone: "brilho", modo: "atualizacao" },
    { id: "exp-pratica", rotulo: "Melhorar o cuidado dos meus pacientes", desc: "O que muda a minha conduta", icone: "pulso", modo: "atualizacao" },
    { id: "exp-controversias", rotulo: "Acompanhar controvérsias", desc: "Onde a evidência diverge", icone: "alvo", modo: "atualizacao" },
    { id: "exp-ensinar", rotulo: "Ensinar e discutir com a equipe", desc: "Referências para residentes e colegas", icone: "capelo", modo: "ensino" },
    OBJ_OUTRO,
  ],
  professor: [
    { id: "prof-aulas", rotulo: "Preparar aulas", desc: "Diretrizes e revisões de referência", icone: "capelo", modo: "ensino" },
    { id: "prof-conteudo", rotulo: "Atualizar o que eu ensino", desc: "Novidades que mudam o conteúdo das aulas", icone: "brilho", modo: "atualizacao" },
    { id: "prof-clube", rotulo: "Clube de revista e discussões", desc: "Artigos bons para discutir em grupo", icone: "documento", modo: "atualizacao" },
    { id: "prof-pratica", rotulo: "Me manter atualizado na prática", desc: "O que muda a conduta", icone: "pulso", modo: "atualizacao" },
    OBJ_OUTRO,
  ],
  outro: [
    { id: "fundamentos", rotulo: "Aprender os fundamentos", desc: "Entender bem o básico, do jeito certo", icone: "livro", modo: "fundamentos" },
    { id: "atualizar", rotulo: "Me manter atualizado", desc: "Só o que é novo e relevante", icone: "brilho", modo: "atualizacao" },
    { id: "pratica", rotulo: "Melhorar o cuidado do paciente", desc: "O que muda a minha conduta", icone: "pulso", modo: "atualizacao" },
    { id: "prova", rotulo: "Prova de título / R+", desc: "Diretrizes e temas mais cobrados", icone: "alvo", modo: "prova" },
    { id: "ensinar", rotulo: "Preparar aulas e ensinar", desc: "Material de referência para ensinar", icone: "capelo", modo: "ensino" },
    OBJ_OUTRO,
  ],
};
const objetivoDef = (id) => Object.values(OBJETIVOS_POR_GRUPO).flat().find((o) => o.id === id);

// Estudante: fase do curso e o que costuma estar sendo cursado em cada fase.
const FASES_CURSO = [
  { id: "basico", rotulo: "Ciclo básico", desc: "1º e 2º ano", icone: "livro" },
  { id: "clinico", rotulo: "Ciclo clínico", desc: "3º e 4º ano", icone: "esteto" },
  { id: "internato", rotulo: "Internato", desc: "5º e 6º ano", icone: "pulso" },
];
const CURSANDO_POR_FASE = {
  basico: ["Anatomia", "Fisiologia", "Bioquímica", "Farmacologia", "Patologia", "Imunologia", "Microbiologia", "Semiologia"],
  clinico: ["Semiologia", "Cardiologia", "Pneumologia", "Gastroenterologia", "Nefrologia", "Endocrinologia", "Infectologia", "Neurologia", "Pediatria", "Ginecologia e Obstetrícia", "Técnica cirúrgica"],
  internato: ["Clínica Médica", "Cirurgia Geral", "Pediatria", "Ginecologia e Obstetrícia", "Medicina de Família e Comunidade", "Urgência e Emergência", "Saúde Mental", "Saúde Coletiva"],
};

// Especialistas: onde atuam. Professores: para quem ensinam.
const CENARIOS = ["Enfermaria / hospital", "Pronto-socorro / plantão", "UTI", "Ambulatório / consultório", "Centro cirúrgico", "Atenção primária", "Telemedicina"];
const PUBLICOS = ["Graduação", "Internato", "Residência", "Pós-graduação", "Educação continuada"];

// As 55 especialidades médicas reconhecidas pelo CFM — só para autocompletar.
const ESPECIALIDADES_CFM = [
  "Acupuntura", "Alergia e Imunologia", "Anestesiologia", "Angiologia", "Cardiologia", "Cirurgia Cardiovascular",
  "Cirurgia da Mão", "Cirurgia de Cabeça e Pescoço", "Cirurgia do Aparelho Digestivo", "Cirurgia Geral",
  "Cirurgia Oncológica", "Cirurgia Pediátrica", "Cirurgia Plástica", "Cirurgia Torácica", "Cirurgia Vascular",
  "Clínica Médica", "Coloproctologia", "Dermatologia", "Endocrinologia e Metabologia", "Endoscopia",
  "Gastroenterologia", "Genética Médica", "Geriatria", "Ginecologia e Obstetrícia", "Hematologia e Hemoterapia",
  "Homeopatia", "Infectologia", "Mastologia", "Medicina de Emergência", "Medicina de Família e Comunidade",
  "Medicina do Trabalho", "Medicina de Tráfego", "Medicina Esportiva", "Medicina Física e Reabilitação",
  "Medicina Intensiva", "Medicina Legal e Perícia Médica", "Medicina Nuclear", "Medicina Preventiva e Social",
  "Nefrologia", "Neurocirurgia", "Neurologia", "Nutrologia", "Oftalmologia", "Oncologia Clínica",
  "Ortopedia e Traumatologia", "Otorrinolaringologia", "Patologia", "Patologia Clínica/Medicina Laboratorial",
  "Pediatria", "Pneumologia", "Psiquiatria", "Radiologia e Diagnóstico por Imagem", "Radioterapia",
  "Reumatologia", "Urologia",
];

const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Liga o texto livre digitado pelo médico a uma entrada do catálogo, quando houver.
function acharEspecialidade(texto) {
  const n = normalizar(texto);
  if (!n) return null;
  const apelidos = { go: ["ginecologia", "obstetricia", "gineco"], clinica: ["clinica medica", "medicina interna"], emergencia: ["emergencia"], anestesio: ["anestesio"] };
  for (const [id, e] of Object.entries(ESPECIALIDADES)) {
    const nome = normalizar(e.nome);
    if (n === nome || n.includes(nome) || (n.length > 4 && nome.includes(n))) return id;
    if ((apelidos[id] || []).some((a) => n.includes(a))) return id;
  }
  return null;
}
function acharRodizio(idEsp, texto) {
  const n = normalizar(texto);
  const lista = ESPECIALIDADES[idEsp]?.rodizios || [];
  return lista.find((r) => normalizar(r.nome) === n) || lista.find((r) => n.length > 3 && (normalizar(r.nome).includes(n) || n.includes(normalizar(r.nome)))) || null;
}
function acharTemaNoCatalogo(pt) {
  const n = normalizar(pt);
  for (const e of Object.values(ESPECIALIDADES)) {
    for (const lista of [...(e.rodizios || []).map((r) => r.temas), ...Object.values(e.areas || {})]) {
      const achado = lista.find((t) => normalizar(t.pt) === n);
      if (achado) return achado;
    }
  }
  return null;
}
