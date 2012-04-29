if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  var cpu0 = {
    gprLo   : new Uint32Array(32),
    gprHi   : new Uint32Array(32),
    control : new Uint32Array(32),

    pc      : 0,
    delayPC : 0,

    halt : false,     // used to flag r4300 to cease execution

    multHi : new Uint32Array(2),
    multLo : new Uint32Array(2),

    opsExecuted : 0,

    reset : function () {

      for (var i = 0; i < 32; ++i) {
        this.gprLo[i]   = 0;
        this.gprHi[i]   = 0;
        this.control[i] = 0;
      }

      this.pc          = 0;
      this.delayPC     = 0;

      this.multLo[0]   = this.multLo[1] = 0;
      this.multHi[0]   = this.multHi[1] = 0;

      this.opsExecuted = 0;
    },

    branch : function(new_pc) {
      if (new_pc < 0) {
        n64js.log('Oops, branching to negative address: ' + new_pc);
        throw 'Oops, branching to negative address: ' + new_pc;
      }
      this.delayPC = new_pc;
    },

    gprRegisterNames : [
            "r0", "at", "v0", "v1", "a0", "a1", "a2", "a3",
            "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
            "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
            "t8", "t9", "k0", "k1", "gp", "sp", "s8", "ra",
    ],

    // General purpose register constants
    kRegister_r0 : 0x00,
    kRegister_at : 0x01,
    kRegister_v0 : 0x02,
    kRegister_v1 : 0x03,
    kRegister_a0 : 0x04,
    kRegister_a1 : 0x05,
    kRegister_a2 : 0x06,
    kRegister_a3 : 0x07,
    kRegister_t0 : 0x08,
    kRegister_t1 : 0x09,
    kRegister_t2 : 0x0a,
    kRegister_t3 : 0x0b,
    kRegister_t4 : 0x0c,
    kRegister_t5 : 0x0d,
    kRegister_t6 : 0x0e,
    kRegister_t7 : 0x0f,
    kRegister_s0 : 0x10,
    kRegister_s1 : 0x11,
    kRegister_s2 : 0x12,
    kRegister_s3 : 0x13,
    kRegister_s4 : 0x14,
    kRegister_s5 : 0x15,
    kRegister_s6 : 0x16,
    kRegister_s7 : 0x17,
    kRegister_t8 : 0x18,
    kRegister_t9 : 0x19,
    kRegister_k0 : 0x1a,
    kRegister_k1 : 0x1b,
    kRegister_gp : 0x1c,
    kRegister_sp : 0x1d,
    kRegister_s8 : 0x1e,
    kRegister_ra : 0x1f,

    // Control register constants
    kControlIndex     : 0,
    kControlRand      : 1,
    kControlEntryLo0  : 2,
    kControlEntryLo1  : 3,
    kControlContext   : 4,
    kControlPageMask  : 5,
    kControlWired     : 6,
    //...
    kControlBadVAddr  : 8,
    kControlCount     : 9,
    kControlEntryHi   : 10,
    kControlCompare   : 11,
    kControlSR        : 12,
    kControlCause     : 13,
    kControlEPC       : 14,
    kControlPRId      : 15,
    kControlConfig    : 16,
    kControlLLAddr    : 17,
    kControlWatchLo   : 18,
    kControlWatchHi   : 19,
    //...
    kControlECC       : 26,
    kControlCacheErr  : 27,
    kControlTagLo     : 28,
    kControlTagHi     : 29,
    kControlErrorEPC  : 30
  };

  // Expose the cpu state
  n64js.cpu0 = cpu0;


  function     fd(i) { return (i>>> 6)&0x1f; }
  function     fs(i) { return (i>>>11)&0x1f; }
  function     ft(i) { return (i>>>16)&0x1f; }
  function  copop(i) { return (i>>>21)&0x1f; }

  function offset(i) { return ((i&0xffff)<<16)>>16; }
  function     sa(i) { return (i>>> 6)&0x1f; }
  function     rd(i) { return (i>>>11)&0x1f; }
  function     rt(i) { return (i>>>16)&0x1f; }
  function     rs(i) { return (i>>>21)&0x1f; }
  function     op(i) { return (i>>>26)&0x1f; }

  function target(i) { return (i     )&0x3ffffff; }
  function    imm(i) { return (i     )&0xffff; }
  function   imms(i) { return ((i&0xffff)<<16)>>16; }   // treat immediate value as signed
  function   base(i) { return (i>>>21)&0x1f; }

  function memaddr(i) {
      return cpu0.gprLo[base(i)] + imms(i);
  }

  function branchAddress(a,i) { return ((a+4) + (offset(i)*4))>>>0; }
  function   jumpAddress(a,i) { return ((a&0xf0000000) | (target(i)*4))>>>0; }

  function setSignExtend(r,v) {
    cpu0.gprLo[r] = v;
    cpu0.gprHi[r] = (v & 0x80000000) ? 0xffffffff : 0x00000000;  // sign-extend
  }

  function setZeroExtend(r, v) {
    cpu0.gprLo[r] = v;
    cpu0.gprHi[r] = 0x00000000;
  }

  function setHiLoSignExtend(arr, v) {
    arr[0] = (v&0xffffffff) >>> 0;
    arr[1] = v>>>32;
  }


  function unimplemented(a,i) {
    var r = n64js.disassembleOp(a,i);
    var e = 'Unimplemented op ' + n64js.toHex(i,32) + ' : ' + r.disassembly + '<br>';

    $('#output').append(e);
    throw e;
  }

  function executeUnknown(a,i) {
    throw 'unimplemented op: ' + n64js.toHex(a,32) + ', ' + n64js.toHex(i, 32);
  }

  function executeSLL(a,i) {
    // Special-case NOP
    if (i == 0)
      return;

    setSignExtend( rd(i), ((cpu0.gprLo[rt(i)] << sa(i)) & 0xffffffff)>>>0 );
  }

  function executeSRL(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rt(i)] >> sa(i) );
  }
  function executeSRA(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rt(i)] >>> sa(i) );
  }
  function executeSLLV(a,i) {
    setSignExtend( rd(i), (cpu0.gprLo[rt(i)] <<  (cpu0.gprLo[rs(i)] & 0x1f)) & 0xffffffff );
  }
  function executeSRLV(a,i) {
    setSignExtend( rd(i),  cpu0.gprLo[rt(i)] >>> (cpu0.gprLo[rs(i)] & 0x1f) );
  }
  function executeSRAV(a,i) {
    setSignExtend( rd(i),  cpu0.gprLo[rt(i)] >>  (cpu0.gprLo[rs(i)] & 0x1f) );
  }
  function executeJR(a,i) {
    cpu0.branch( cpu0.gprLo[rs(i)] );
  }
  function executeJALR(a,i)       { unimplemented(a,i); }
  function executeSYSCALL(a,i)    { unimplemented(a,i); }
  function executeBREAK(a,i)      { unimplemented(a,i); }
  function executeSYNC(a,i)       { unimplemented(a,i); }
  function executeMFHI(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.multHi[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multHi[0]; 
  }
  function executeMTHI(a,i) {

  }
  function executeMFLO(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.multLo[1]; 
    cpu0.gprLo[rd(i)] = cpu0.multLo[0]; 
  }
  function executeMTLO(a,i)       { unimplemented(a,i); }
  function executeDSLLV(a,i)      { unimplemented(a,i); }
  function executeDSRLV(a,i)      { unimplemented(a,i); }
  function executeDSRAV(a,i)      { unimplemented(a,i); }
  function executeMULT(a,i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit *signed*!
    var lo = (result&0xffffffff)>>>0;
    var hi = (result>>>32);
    setHiLoSignExtend( cpu0.multLo, lo );
    setHiLoSignExtend( cpu0.multHi, hi );
  }
  function executeMULTU(a,i) {
    var result = cpu0.gprLo[rs(i)] * cpu0.gprLo[rt(i)];   // needs to be 64-bit!
    var lo = (result&0xffffffff)>>>0;
    var hi = (result>>>32);
    setHiLoSignExtend( cpu0.multLo, lo );
    setHiLoSignExtend( cpu0.multHi, hi );
  }
  function executeDIV(a,i)        { unimplemented(a,i); }
  function executeDIVU(a,i)       { unimplemented(a,i); }
  function executeDMULT(a,i)      { unimplemented(a,i); }
  function executeDMULTU(a,i)     { unimplemented(a,i); }
  function executeDDIV(a,i)       { unimplemented(a,i); }
  function executeDDIVU(a,i)      { unimplemented(a,i); }

  function executeADD(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] + cpu0.gprLo[rt(i)] ); // s32 + s32
  }
  function executeADDU(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] + cpu0.gprLo[rt(i)] ); // s32 + s32
  }

  function executeSUB(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] - cpu0.gprLo[rt(i)] ); // s32 - s32
  }
  function executeSUBU(a,i) {
    setSignExtend( rd(i), cpu0.gprLo[rs(i)] - cpu0.gprLo[rt(i)] ); // s32 - s32
  }

  function executeAND(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] & cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] & cpu0.gprLo[rt(i)];
  }

  function executeOR(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] | cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] | cpu0.gprLo[rt(i)];
  }

  function executeXOR(a,i) {
    cpu0.gprHi[rd(i)] = cpu0.gprHi[rs(i)] ^ cpu0.gprHi[rt(i)];
    cpu0.gprLo[rd(i)] = cpu0.gprLo[rs(i)] ^ cpu0.gprLo[rt(i)];
  }

  function executeNOR(a,i)        { unimplemented(a,i); }
  function executeSLT(a,i) {
    var r = 0;
    // FIXME: this needs to do a signed compare. 
    if (cpu0.gprHi[rs(i)] < cpu0.gprHi[rt(i)] ||
        (cpu0.gprHi[rs(i)] === cpu0.gprHi[rt(i)] && cpu0.gprLo[rs(i)] < cpu0.gprLo[rt(i)])) {
      r = 1;
    }
    setZeroExtend(rd(i), r);
  }
  function executeSLTU(a,i) {
    var r = 0;
    if (cpu0.gprHi[rs(i)] < cpu0.gprHi[rt(i)] ||
        (cpu0.gprHi[rs(i)] === cpu0.gprHi[rt(i)] && cpu0.gprLo[rs(i)] < cpu0.gprLo[rt(i)])) {
      r = 1;
    }
    setZeroExtend(rd(i), r);
  }
  function executeDADD(a,i)       { unimplemented(a,i); }
  function executeDADDU(a,i)      { unimplemented(a,i); }
  function executeDSUB(a,i)       { unimplemented(a,i); }
  function executeDSUBU(a,i)      { unimplemented(a,i); }
  function executeTGE(a,i)        { unimplemented(a,i); }
  function executeTGEU(a,i)       { unimplemented(a,i); }
  function executeTLT(a,i)        { unimplemented(a,i); }
  function executeTLTU(a,i)       { unimplemented(a,i); }
  function executeTEQ(a,i)        { unimplemented(a,i); }
  function executeTNE(a,i)        { unimplemented(a,i); }
  function executeDSLL(a,i)       { unimplemented(a,i); }
  function executeDSRL(a,i)       { unimplemented(a,i); }
  function executeDSRA(a,i)       { unimplemented(a,i); }
  function executeDSLL32(a,i)     { unimplemented(a,i); }
  function executeDSRL32(a,i)     { unimplemented(a,i); }
  function executeDSRA32(a,i)     { unimplemented(a,i); }
  function executeMFC0(a,i)       { unimplemented(a,i); }
  function executeMTC0(a,i)       { /* FIXME */; }
  function executeTLB(a,i)        { unimplemented(a,i); }
  function executeBLTZ(a,i) {
    if ((cpu0.gprHi[rs(i)] & 0x80000000) !== 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBGEZ(a,i) {
    if ((cpu0.gprHi[rs(i)] & 0x80000000) === 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBLTZL(a,i) {
    if ((cpu0.gprHi[rs(i)] & 0x80000000) !== 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBGEZL(a,i) {
    if ((cpu0.gprHi[rs(i)] & 0x80000000) === 0) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeTGEI(a,i)       { unimplemented(a,i); }
  function executeTGEIU(a,i)      { unimplemented(a,i); }
  function executeTLTI(a,i)       { unimplemented(a,i); }
  function executeTLTIU(a,i)      { unimplemented(a,i); }
  function executeTEQI(a,i)       { unimplemented(a,i); }
  function executeTNEI(a,i)       { unimplemented(a,i); }

  function executeBLTZAL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if ((cpu0.gprHi[rs(i)] & 0x80000000) !== 0) {
      cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBGEZAL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    if ((cpu0.gprHi[rs(i)] & 0x80000000) === 0) {
      cpu0.branch( branchAddress(a,i) );
    }
  }

  function executeBLTZALL(a,i)    { unimplemented(a,i); }
  function executeBGEZALL(a,i)    { unimplemented(a,i); }
  function executeJ(a,i)          { unimplemented(a,i); }
  function executeJAL(a,i) {
    setSignExtend(cpu0.kRegister_ra, cpu0.pc + 8);
    cpu0.branch( jumpAddress(a,i) );
  }
  function executeBEQ(a,i) {
    if (cpu0.gprLo[rs(i)] === cpu0.gprLo[rt(i)]) {
      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBNE(a,i)        {
    if (cpu0.gprLo[rs(i)] !== cpu0.gprLo[rt(i)]) {
      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    }
  }
  function executeBLEZ(a,i)       { unimplemented(a,i); }
  function executeBGTZ(a,i)       { unimplemented(a,i); }
  function executeADDI(a,i) {
    var a = cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }
  function executeADDIU(a,i) {
    var a = cpu0.gprLo[rs(i)];
    var v = imms(i);
    setSignExtend(rt(i), a + v);
  }
  function executeSLTI(a,i) {
    // FIXME: this needs to do a full 64bit compare?
    cpu0.gprHi[rt(i)] = 0;
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] < imms(i) ? 1 : 0;
  }
  function executeSLTIU(a,i)      { unimplemented(a,i); }
  
  function executeANDI(a,i) {
    cpu0.gprHi[rt(i)] = 0;    // always 0, as sign extended immediate value is always 0
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] & imm(i);    
  }
  
  function executeORI(a,i) {
    cpu0.gprHi[rt(i)] = cpu0.gprHi[rs(i)];
    cpu0.gprLo[rt(i)] = cpu0.gprLo[rs(i)] | imm(i);
  }
  
  function executeXORI(a,i) {
    // High 32 bits are always unchanged, as sign extended immediate value is always 0
    var lo = cpu0.gprLo[rs(i)] ^ imm(i);
    cpu0.gprLo[rt(i)] = lo;    
  }
  
  function executeLUI(a,i) {
    var v  = imms(i) << 16;
    setSignExtend(rt(i), v);
  }
  
  function executeCop0(a,i)       { unimplemented(a,i); }
  function executeCopro1(a,i)     { unimplemented(a,i); }
  function executeBEQL(a,i) {
    if (cpu0.gprHi[rs(i)] === cpu0.gprHi[rt(i)] &&
        cpu0.gprLo[rs(i)] === cpu0.gprLo[rt(i)] ) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBNEL(a,i) {
    if (cpu0.gprHi[rs(i)] !== cpu0.gprHi[rt(i)] ||
        cpu0.gprLo[rs(i)] !== cpu0.gprLo[rt(i)] ) {

      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }
  function executeBLEZL(a,i) {
    var hi = cpu0.gprHi[rs(i)];
    var lo = cpu0.gprLo[rs(i)];
    if ( (hi & 0x80000000) !== 0 || (hi === 0 && (lo & 0x80000000) !== 0) ) {

      // NB: if rs == r0 then this branch is always taken
      // NB: if imms(i) == -1 then this is a branch to self/busywait
      cpu0.branch( branchAddress(a,i) );
    } else {
      cpu0.pc += 4;   // skip the next instruction
    }
  }

  function executeBGTZL(a,i)      { unimplemented(a,i); }
  function executeDADDI(a,i)      { unimplemented(a,i); }
  function executeDADDIU(a,i)     { unimplemented(a,i); }
  function executeLDL(a,i)        { unimplemented(a,i); }
  function executeLDR(a,i)        { unimplemented(a,i); }
  function executeLB(a,i)         { unimplemented(a,i); }
  function executeLH(a,i)         { unimplemented(a,i); }
  function executeLWL(a,i)        { unimplemented(a,i); }
  function executeLW(a,i)         {
    // SF2049 requires this, apparently
    if (rt(i) == 0)
      return;
    setSignExtend(rt(i), n64js.readMemory32( memaddr(i) ));
  }
  function executeLBU(a,i) {
    setZeroExtend(rt(i), n64js.readMemory8( memaddr(i) ));
  }
  function executeLHU(a,i)        { unimplemented(a,i); }
  function executeLWR(a,i)        { unimplemented(a,i); }
  function executeLWU(a,i)        { unimplemented(a,i); }
  function executeSB(a,i) {
    n64js.writeMemory8(memaddr(i), cpu0.gprLo[rt(i)] & 0xff );
  }
  function executeSH(a,i)         { unimplemented(a,i); }
  function executeSWL(a,i)        { unimplemented(a,i); }
  function executeSW(a,i)         {
    n64js.writeMemory32(memaddr(i), cpu0.gprLo[rt(i)]);
  }
  function executeSDL(a,i)        { unimplemented(a,i); }
  function executeSDR(a,i)        { unimplemented(a,i); }
  function executeSWR(a,i)        { unimplemented(a,i); }
  function executeCACHE(a,i) {
    // ignore!
  }
  function executeLL(a,i)         { unimplemented(a,i); }
  function executeLWC1(a,i)       { unimplemented(a,i); }
  function executeLLD(a,i)        { unimplemented(a,i); }
  function executeLDC1(a,i)       { unimplemented(a,i); }
  function executeLDC2(a,i)       { unimplemented(a,i); }
  function executeLD(a,i)         { unimplemented(a,i); }
  function executeSC(a,i)         { unimplemented(a,i); }
  function executeSWC1(a,i)       { unimplemented(a,i); }
  function executeSCD(a,i)        { unimplemented(a,i); }
  function executeSDC1(a,i)       { unimplemented(a,i); }
  function executeSDC2(a,i)       { unimplemented(a,i); }
  function executeSD(a,i)         { unimplemented(a,i); }

  var specialTable = [
    executeSLL,
    executeUnknown,
    executeSRL,
    executeSRA,
    executeSLLV,
    executeUnknown,
    executeSRLV,
    executeSRAV,
    executeJR,
    executeJALR,
    executeUnknown,
    executeUnknown,
    executeSYSCALL,
    executeBREAK,
    executeUnknown,
    executeSYNC,
    executeMFHI,
    executeMTHI,
    executeMFLO,
    executeMTLO,
    executeDSLLV,
    executeUnknown,
    executeDSRLV,
    executeDSRAV,
    executeMULT,
    executeMULTU,
    executeDIV,
    executeDIVU,
    executeDMULT,
    executeDMULTU,
    executeDDIV,
    executeDDIVU,
    executeADD,
    executeADDU,
    executeSUB,
    executeSUBU,
    executeAND,
    executeOR,
    executeXOR,
    executeNOR,
    executeUnknown,
    executeUnknown,
    executeSLT,
    executeSLTU,
    executeDADD,
    executeDADDU,
    executeDSUB,
    executeDSUBU,
    executeTGE,
    executeTGEU,
    executeTLT,
    executeTLTU,
    executeTEQ,
    executeUnknown,
    executeTNE,
    executeUnknown,
    executeDSLL,
    executeUnknown,
    executeDSRL,
    executeDSRA,
    executeDSLL32,
    executeUnknown,
    executeDSRL32,
    executeDSRA32
  ];
  if (specialTable.length != 64) {
    throw "Oops, didn't build the special table correctly";
  }

  function executeSpecial(a,i) {
    var fn = i & 0x3f;
    return specialTable[fn](a,i);
  }

  var cop0Table = [
    executeMFC0,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeMTC0,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    
    executeTLB,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
  ];
  if (cop0Table.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }
  function executeCop0(a,i) {
    var fmt = (i>>21) & 0x1f;
    return cop0Table[fmt](a,i);
  }

  var regImmTable = [
    executeBLTZ,
    executeBGEZ,
    executeBLTZL,
    executeBGEZL,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,

    executeTGEI,
    executeTGEIU,
    executeTLTI,
    executeTLTIU,
    executeTEQI,
    executeUnknown,
    executeTNEI,
    executeUnknown,
    
    executeBLTZAL,
    executeBGEZAL,
    executeBLTZALL,
    executeBGEZALL,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
  ];
  if (regImmTable.length != 32) {
    throw "Oops, didn't build the special table correctly";
  }  

  function executeRegImm(a,i) {
    var rt = (i >> 16) & 0x1f;
    return regImmTable[rt](a,i);
  }

  var simpleTable = [
    executeSpecial,
    executeRegImm,
    executeJ,
    executeJAL,
    executeBEQ,
    executeBNE,
    executeBLEZ,
    executeBGTZ,
    executeADDI,
    executeADDIU,
    executeSLTI,
    executeSLTIU,
    executeANDI,
    executeORI,
    executeXORI,
    executeLUI,
    executeCop0,
    executeCopro1,
    executeUnknown,
    executeUnknown,
    executeBEQL,
    executeBNEL,
    executeBLEZL,
    executeBGTZL,
    executeDADDI,
    executeDADDIU,
    executeLDL,
    executeLDR,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeUnknown,
    executeLB,
    executeLH,
    executeLWL,
    executeLW,
    executeLBU,
    executeLHU,
    executeLWR,
    executeLWU,
    executeSB,
    executeSH,
    executeSWL,
    executeSW,
    executeSDL,
    executeSDR,
    executeSWR,
    executeCACHE,
    executeLL,
    executeLWC1,
    executeUnknown,
    executeUnknown,
    executeLLD,
    executeLDC1,
    executeLDC2,
    executeLD,
    executeSC,
    executeSWC1,
    executeUnknown,
    executeUnknown,
    executeSCD,
    executeSDC1,
    executeSDC2,
    executeSD,
  ];
  if (simpleTable.length != 64) {
    throw "Oops, didn't build the simple table correctly";
  }

  function executeOp(a,i) {
    var opcode = (i >> 26) & 0x3f;

    return simpleTable[opcode](a,i);
  }

  n64js.step = function () {
    n64js.run(1);
  }

  n64js.run = function (cycles) {

    cpu0.halt = false;

    for (var i = 0; i < cycles && !cpu0.halt; ++i) {
        try {
          var pc  = cpu0.pc;
          var dpc = cpu0.delayPC;

          var instruction = n64js.readMemory32(pc);
          executeOp(pc, instruction);

          if (dpc !== 0) {
            cpu0.delayPC = 0;
            cpu0.pc      = dpc;
          } else {
            cpu0.pc      += 4;
          }

          ++cpu0.opsExecuted;

        } catch (e) {
          n64js.halt('Exception :' + e);
          break;
        }
    }

    n64js.refreshDisplay();
  }

})();